// SPDX-License-Identifier: Apache-2.0
#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/sched.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#ifndef LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET
#define LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET (1ULL << 0)
#endif
#ifndef LANDLOCK_SCOPE_SIGNAL
#define LANDLOCK_SCOPE_SIGNAL (1ULL << 1)
#endif
#ifndef LANDLOCK_RESTRICT_SELF_TSYNC
#define LANDLOCK_RESTRICT_SELF_TSYNC (1U << 3)
#endif

#define REVIEWED_LANDLOCK_ABI_MAX 8
#define MAX_RUNTIME_FILES 32
#define NODE_FD 4
#define ADAPTER_FD 5
#define INPUT_FD 6
#define REPOSITORY_FD 7
#define OUTPUT_FD 8
#define SCRATCH_FD 9
#define CONFIGURATION_FD 10
#define FIRST_RUNTIME_FD 11

/* Linux v6.13+ x86_64 syscall numbers, pinned with the reviewed v7.0 UAPI. */
#ifndef __NR_setxattrat
#define __NR_setxattrat 463
#endif
#ifndef __NR_removexattrat
#define __NR_removexattrat 466
#endif
#ifndef __NR_file_setattr
#define __NR_file_setattr 469
#endif

#if defined(__x86_64__) && __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
#define REVIEWED_AUDIT_ARCH AUDIT_ARCH_X86_64
#define X32_SYSCALL_BIT 0x40000000U
#define REVIEWED_X86_64_TCGETS 0x5401U
#define REVIEWED_X86_64_TCGETS2 0x802c542aU
#define REVIEWED_X86_64_FIONBIO 0x5421U
#else
#error "Landlock candidate seccomp policy is reviewed only for little-endian x86_64"
#endif

#define DENY_SYSCALL(name) \
	BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_##name, 0, 1), \
	BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA))

extern char **environ;

static void die(const char *message)
{
	perror(message);
	_exit(111);
}

static int landlock_create_ruleset(const struct landlock_ruleset_attr *attr,
				   size_t size, uint32_t flags)
{
	return syscall(__NR_landlock_create_ruleset, attr, size, flags);
}

static int landlock_add_path_rule(int ruleset_fd, int parent_fd,
				  uint64_t allowed_access)
{
	const struct landlock_path_beneath_attr rule = {
		.allowed_access = allowed_access,
		.parent_fd = parent_fd,
	};

	return syscall(__NR_landlock_add_rule, ruleset_fd,
		       LANDLOCK_RULE_PATH_BENEATH, &rule, 0);
}

static int landlock_restrict_self(int ruleset_fd, uint32_t flags)
{
	return syscall(__NR_landlock_restrict_self, ruleset_fd, flags);
}

static int current_abi(void)
{
	const int abi = landlock_create_ruleset(NULL, 0,
						LANDLOCK_CREATE_RULESET_VERSION);

	if (abi < 0)
		die("landlock_create_ruleset(VERSION)");
	if (abi < 3 || abi > REVIEWED_LANDLOCK_ABI_MAX) {
		errno = EPROTONOSUPPORT;
		die("unreviewed Landlock ABI");
	}
	return abi;
}

static int parse_fd(const char *value)
{
	char *end = NULL;
	long number;

	errno = 0;
	number = strtol(value, &end, 10);
	if (errno || !end || *end != '\0' || number < 3 || number > 1024) {
		errno = EINVAL;
		die("invalid inherited descriptor");
	}
	return (int)number;
}

static void require_descriptor_type(int fd, mode_t type)
{
	struct stat statbuf;

	if (fstat(fd, &statbuf) != 0)
		die("fstat inherited descriptor");
	if ((statbuf.st_mode & S_IFMT) != type) {
		errno = EINVAL;
		die("inherited descriptor type changed");
	}
}

static uint64_t handled_filesystem_rights(int abi)
{
	uint64_t rights = LANDLOCK_ACCESS_FS_EXECUTE |
		LANDLOCK_ACCESS_FS_WRITE_FILE |
		LANDLOCK_ACCESS_FS_READ_FILE |
		LANDLOCK_ACCESS_FS_READ_DIR |
		LANDLOCK_ACCESS_FS_REMOVE_DIR |
		LANDLOCK_ACCESS_FS_REMOVE_FILE |
		LANDLOCK_ACCESS_FS_MAKE_CHAR |
		LANDLOCK_ACCESS_FS_MAKE_DIR |
		LANDLOCK_ACCESS_FS_MAKE_REG |
		LANDLOCK_ACCESS_FS_MAKE_SOCK |
		LANDLOCK_ACCESS_FS_MAKE_FIFO |
		LANDLOCK_ACCESS_FS_MAKE_BLOCK |
		LANDLOCK_ACCESS_FS_MAKE_SYM |
		LANDLOCK_ACCESS_FS_REFER |
		LANDLOCK_ACCESS_FS_TRUNCATE;

	if (abi >= 5)
		rights |= LANDLOCK_ACCESS_FS_IOCTL_DEV;
	return rights;
}

static void add_path_rule(int ruleset_fd, int parent_fd, uint64_t rights)
{
	if (landlock_add_path_rule(ruleset_fd, parent_fd, rights) != 0)
		die("landlock_add_rule(PATH_BENEATH)");
}

static void install_seccomp_filter(void)
{
	static const struct sock_filter instructions[] = {
		BPF_STMT(BPF_LD | BPF_W | BPF_ABS,
			 offsetof(struct seccomp_data, arch)),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, REVIEWED_AUDIT_ARCH, 1, 0),
		BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
		BPF_STMT(BPF_LD | BPF_W | BPF_ABS,
			 offsetof(struct seccomp_data, nr)),
		BPF_JUMP(BPF_JMP | BPF_JGE | BPF_K, X32_SYSCALL_BIT, 0, 1),
		BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),

		/* No new processes.  V8 may retain pthread clone(CLONE_THREAD). */
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_clone, 0, 4),
		BPF_STMT(BPF_LD | BPF_W | BPF_ABS,
			 offsetof(struct seccomp_data, args[0])),
		BPF_STMT(BPF_ALU | BPF_AND | BPF_K, CLONE_THREAD),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, 0, 1),
		BPF_STMT(BPF_RET | BPF_K,
			 SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
		BPF_STMT(BPF_LD | BPF_W | BPF_ABS,
			 offsetof(struct seccomp_data, nr)),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_clone3, 0, 1),
		BPF_STMT(BPF_RET | BPF_K,
			 SECCOMP_RET_ERRNO | (ENOSYS & SECCOMP_RET_DATA)),
		DENY_SYSCALL(fork),
		DENY_SYSCALL(vfork),
		DENY_SYSCALL(socket),
		DENY_SYSCALL(socketpair),

		/* Persistent file metadata mutation not mediated by Landlock ABI 8. */
		DENY_SYSCALL(chmod),
		DENY_SYSCALL(fchmod),
		DENY_SYSCALL(fchmodat),
		DENY_SYSCALL(fchmodat2),
		DENY_SYSCALL(chown),
		DENY_SYSCALL(fchown),
		DENY_SYSCALL(lchown),
		DENY_SYSCALL(fchownat),
		DENY_SYSCALL(utime),
		DENY_SYSCALL(utimes),
		DENY_SYSCALL(futimesat),
		DENY_SYSCALL(utimensat),
		DENY_SYSCALL(setxattr),
		DENY_SYSCALL(lsetxattr),
		DENY_SYSCALL(fsetxattr),
		DENY_SYSCALL(removexattr),
		DENY_SYSCALL(lremovexattr),
		DENY_SYSCALL(fremovexattr),
		DENY_SYSCALL(setxattrat),
		DENY_SYSCALL(removexattrat),
		DENY_SYSCALL(file_setattr),

		/* Node probes stdio with TCGETS2; every other raw ioctl is refused. */
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, __NR_ioctl, 0, 5),
		BPF_STMT(BPF_LD | BPF_W | BPF_ABS,
			 offsetof(struct seccomp_data, args[1])),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, REVIEWED_X86_64_TCGETS, 3, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, REVIEWED_X86_64_TCGETS2, 2, 0),
		BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, REVIEWED_X86_64_FIONBIO, 1, 0),
		BPF_STMT(BPF_RET | BPF_K,
			 SECCOMP_RET_ERRNO | (EPERM & SECCOMP_RET_DATA)),
		BPF_STMT(BPF_LD | BPF_W | BPF_ABS,
			 offsetof(struct seccomp_data, nr)),

		/* Anonymous executable and filesystem/topology construction. */
		DENY_SYSCALL(memfd_create),
		DENY_SYSCALL(mount),
		DENY_SYSCALL(umount2),
		DENY_SYSCALL(pivot_root),
		DENY_SYSCALL(chroot),
		DENY_SYSCALL(open_tree),
		DENY_SYSCALL(move_mount),
		DENY_SYSCALL(fsopen),
		DENY_SYSCALL(fsconfig),
		DENY_SYSCALL(fsmount),
		DENY_SYSCALL(fspick),
		DENY_SYSCALL(mount_setattr),
		DENY_SYSCALL(open_by_handle_at),
		DENY_SYSCALL(name_to_handle_at),
		DENY_SYSCALL(mknod),
		DENY_SYSCALL(mknodat),
		DENY_SYSCALL(unshare),
		DENY_SYSCALL(setns),

		/* Kernel-control, cross-process, and privilege mutation surfaces. */
		DENY_SYSCALL(bpf),
		DENY_SYSCALL(ptrace),
		DENY_SYSCALL(userfaultfd),
		DENY_SYSCALL(perf_event_open),
		DENY_SYSCALL(process_vm_writev),
		DENY_SYSCALL(pidfd_getfd),
		DENY_SYSCALL(fanotify_init),
		DENY_SYSCALL(io_uring_setup),
		DENY_SYSCALL(add_key),
		DENY_SYSCALL(request_key),
		DENY_SYSCALL(keyctl),
		DENY_SYSCALL(kexec_load),
		DENY_SYSCALL(finit_module),
		DENY_SYSCALL(init_module),
		DENY_SYSCALL(delete_module),
		DENY_SYSCALL(swapon),
		DENY_SYSCALL(swapoff),
		DENY_SYSCALL(reboot),
		DENY_SYSCALL(iopl),
		DENY_SYSCALL(ioperm),
		DENY_SYSCALL(sethostname),
		DENY_SYSCALL(setdomainname),
		DENY_SYSCALL(acct),
		DENY_SYSCALL(quotactl),
		DENY_SYSCALL(capset),
		DENY_SYSCALL(setuid),
		DENY_SYSCALL(setgid),
		DENY_SYSCALL(setreuid),
		DENY_SYSCALL(setregid),
		DENY_SYSCALL(setresuid),
		DENY_SYSCALL(setresgid),
		DENY_SYSCALL(setfsuid),
		DENY_SYSCALL(setfsgid),
		DENY_SYSCALL(setgroups),
		DENY_SYSCALL(personality),
		DENY_SYSCALL(modify_ldt),

		BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
	};
	const struct sock_fprog program = {
		.len = (unsigned short)(sizeof(instructions) / sizeof(instructions[0])),
		.filter = (struct sock_filter *)instructions,
	};

	if (syscall(__NR_seccomp, SECCOMP_SET_MODE_FILTER, 0, &program) != 0)
		die("seccomp(SECCOMP_SET_MODE_FILTER)");
}

static void self_test_seccomp(int writable_regular_fd)
{
	struct stat statbuf;
	int available = 0, descriptor, ioctl_result, ioctl_errno, socket_pair[2];

	if (fstat(writable_regular_fd, &statbuf) != 0 || !S_ISREG(statbuf.st_mode))
		die("seccomp self-test writable descriptor");
	if (fchmod(writable_regular_fd, statbuf.st_mode & 0777) != 0)
		die("pre-seccomp fchmod capability");
	errno = 0;
	ioctl_result = ioctl(writable_regular_fd, FIONREAD, &available);
	ioctl_errno = errno;
	if (ioctl_result == -1 && ioctl_errno == EPERM) {
		errno = EPROTO;
		die("pre-seccomp ioctl capability");
	}
	errno = 0;
	if (syscall(__NR_removexattrat, writable_regular_fd, "", AT_EMPTY_PATH,
		    "user.lamina-seccomp-self-test") != -1 || errno != ENODATA) {
		errno = EPROTO;
		die("pre-seccomp removexattrat valid-fd capability");
	}
	install_seccomp_filter();
	errno = 0;
	if (fchmod(writable_regular_fd, statbuf.st_mode & 0777) != -1 || errno != EPERM) {
		errno = EPROTO;
		die("seccomp fchmod denial self-test");
	}
	errno = 0;
	descriptor = syscall(__NR_memfd_create, "lamina-seccomp-self-test", 0);
	if (descriptor != -1 || errno != EPERM) {
		if (descriptor >= 0)
			close(descriptor);
		errno = EPROTO;
		die("seccomp memfd denial self-test");
	}
	errno = 0;
	if (syscall(__NR_ioctl, writable_regular_fd, REVIEWED_X86_64_TCGETS2,
		    &available) != -1 || errno == EPERM) {
		errno = EPROTO;
		die("seccomp reviewed TCGETS2 allowance self-test");
	}
	errno = 0;
	if (ioctl(writable_regular_fd, FIONREAD, &available) != -1 || errno != EPERM) {
		errno = EPROTO;
		die("seccomp ioctl denial self-test");
	}
	errno = 0;
	if (syscall(__NR_removexattrat, writable_regular_fd, "", AT_EMPTY_PATH,
		    "user.lamina-seccomp-self-test") != -1 || errno != EPERM) {
		errno = EPROTO;
		die("seccomp removexattrat denial self-test");
	}
	errno = 0;
	if (syscall(__NR_fork) != -1 || errno != EPERM) {
		errno = EPROTO;
		die("seccomp fork denial self-test");
	}
	errno = 0;
	if (syscall(__NR_clone3, NULL, 0) != -1 || errno != ENOSYS) {
		errno = EPROTO;
		die("seccomp clone3 denial self-test");
	}
	errno = 0;
	if (socket(AF_INET, SOCK_STREAM, 0) != -1 || errno != EPERM) {
		errno = EPROTO;
		die("seccomp socket denial self-test");
	}
	errno = 0;
	if (socketpair(AF_UNIX, SOCK_STREAM, 0, socket_pair) != -1 || errno != EPERM) {
		errno = EPROTO;
		die("seccomp socketpair denial self-test");
	}
}

static void run_candidate(int argc, char **argv)
{
	const uint64_t read_file = LANDLOCK_ACCESS_FS_READ_FILE;
	const uint64_t read_execute = read_file | LANDLOCK_ACCESS_FS_EXECUTE;
	const uint64_t bounded_write = read_file | LANDLOCK_ACCESS_FS_WRITE_FILE |
		LANDLOCK_ACCESS_FS_TRUNCATE;
	struct landlock_ruleset_attr ruleset = {0};
	char *candidate_argv[7];
	int runtime_fds[MAX_RUNTIME_FILES];
	int expected_abi, abi, node_fd, adapter_fd, input_fd, repository_fd;
	int output_fd, scratch_fd, configuration_fd, runtime_count, separator, ruleset_fd;
	uint32_t restrict_flags = 0;

	if (argc < 15) {
		errno = EINVAL;
		die("candidate launcher argument count");
	}
	expected_abi = atoi(argv[2]);
	abi = current_abi();
	if (expected_abi != abi) {
		errno = ESTALE;
		die("Landlock ABI changed between query and launch");
	}
	node_fd = parse_fd(argv[3]);
	adapter_fd = parse_fd(argv[4]);
	input_fd = parse_fd(argv[5]);
	repository_fd = parse_fd(argv[6]);
	output_fd = parse_fd(argv[7]);
	scratch_fd = parse_fd(argv[8]);
	configuration_fd = parse_fd(argv[9]);
	if (node_fd != NODE_FD || adapter_fd != ADAPTER_FD || input_fd != INPUT_FD
	    || repository_fd != REPOSITORY_FD || output_fd != OUTPUT_FD
	    || scratch_fd != SCRATCH_FD || configuration_fd != CONFIGURATION_FD) {
		errno = EINVAL;
		die("candidate descriptor layout changed");
	}
	runtime_count = atoi(argv[10]);
	if (runtime_count < 0 || runtime_count > MAX_RUNTIME_FILES) {
		errno = E2BIG;
		die("runtime closure descriptor count");
	}
	separator = 11 + runtime_count;
	if (argc != separator + 1 || strcmp(argv[separator], "--") != 0) {
		errno = EINVAL;
		die("candidate launcher argument boundary");
	}
	for (int index = 0; index < runtime_count; index++) {
		runtime_fds[index] = parse_fd(argv[11 + index]);
		if (runtime_fds[index] != FIRST_RUNTIME_FD + index) {
			errno = EINVAL;
			die("candidate runtime descriptor layout changed");
		}
	}

	require_descriptor_type(node_fd, S_IFREG);
	require_descriptor_type(adapter_fd, S_IFREG);
	require_descriptor_type(input_fd, S_IFREG);
	require_descriptor_type(repository_fd, S_IFDIR);
	require_descriptor_type(output_fd, S_IFREG);
	require_descriptor_type(scratch_fd, S_IFREG);
	require_descriptor_type(configuration_fd, S_IFREG);
	for (int index = 0; index < runtime_count; index++)
		require_descriptor_type(runtime_fds[index], S_IFREG);

	ruleset.handled_access_fs = handled_filesystem_rights(abi);
	if (abi >= 4)
		ruleset.handled_access_net = LANDLOCK_ACCESS_NET_BIND_TCP |
			LANDLOCK_ACCESS_NET_CONNECT_TCP;
	if (abi >= 6)
		ruleset.scoped = LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET |
			LANDLOCK_SCOPE_SIGNAL;
	ruleset_fd = landlock_create_ruleset(&ruleset, sizeof(ruleset), 0);
	if (ruleset_fd < 0)
		die("landlock_create_ruleset(policy)");

	add_path_rule(ruleset_fd, node_fd, read_execute);
	add_path_rule(ruleset_fd, adapter_fd, read_file);
	add_path_rule(ruleset_fd, input_fd, read_file);
	add_path_rule(ruleset_fd, repository_fd,
		      read_file | LANDLOCK_ACCESS_FS_READ_DIR);
	add_path_rule(ruleset_fd, output_fd, bounded_write);
	add_path_rule(ruleset_fd, scratch_fd, bounded_write);
	add_path_rule(ruleset_fd, configuration_fd, read_file);
	for (int index = 0; index < runtime_count; index++)
		add_path_rule(ruleset_fd, runtime_fds[index], read_execute);

	if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0)
		die("prctl(PR_SET_NO_NEW_PRIVS)");
	if (abi >= 8)
		restrict_flags |= LANDLOCK_RESTRICT_SELF_TSYNC;
	if (landlock_restrict_self(ruleset_fd, restrict_flags) != 0)
		die("landlock_restrict_self");
	if (close(ruleset_fd) != 0)
		die("close ruleset");
	self_test_seccomp(scratch_fd);
	for (int fd = 3; fd <= 1024; fd++) {
		if (fd < NODE_FD || fd > SCRATCH_FD)
			close(fd);
	}
	if (fcntl(node_fd, F_SETFD, FD_CLOEXEC) != 0)
		die("seal candidate runtime descriptor");
	for (int fd = ADAPTER_FD; fd <= SCRATCH_FD; fd++) {
		if (fcntl(fd, F_SETFD, 0) != 0)
			die("preserve candidate argument descriptor");
	}

	candidate_argv[0] = "/proc/self/fd/4";
	candidate_argv[1] = "/proc/self/fd/5";
	candidate_argv[2] = "/proc/self/fd/6";
	candidate_argv[3] = "/proc/self/fd/7";
	candidate_argv[4] = "/proc/self/fd/8";
	candidate_argv[5] = "/proc/self/fd/9";
	candidate_argv[6] = NULL;
	if (syscall(__NR_execveat, node_fd, "", candidate_argv, environ,
		    AT_EMPTY_PATH) != 0)
		die("execveat candidate runtime");
}

int main(int argc, char **argv)
{
	if (argc == 2 && strcmp(argv[1], "query") == 0) {
		printf("%d\n", current_abi());
		return fflush(stdout) == 0 ? 0 : 111;
	}
	if (argc >= 2 && strcmp(argv[1], "run") == 0) {
		run_candidate(argc, argv);
		return 111;
	}
	errno = EINVAL;
	die("unknown launcher operation");
}
