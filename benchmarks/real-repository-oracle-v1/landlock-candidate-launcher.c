// SPDX-License-Identifier: Apache-2.0
#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <linux/landlock.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
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
	runtime_count = atoi(argv[10]);
	if (runtime_count < 0 || runtime_count > MAX_RUNTIME_FILES) {
		errno = E2BIG;
		die("runtime closure descriptor count");
	}
	separator = 11 + runtime_count;
	if (argc != separator + 7 || strcmp(argv[separator], "--") != 0) {
		errno = EINVAL;
		die("candidate launcher argument boundary");
	}
	for (int index = 0; index < runtime_count; index++)
		runtime_fds[index] = parse_fd(argv[11 + index]);

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
	for (int fd = 3; fd <= 1024; fd++) {
		if (fd != node_fd)
			close(fd);
	}
	if (fcntl(node_fd, F_SETFD, FD_CLOEXEC) != 0)
		die("seal candidate runtime descriptor");

	candidate_argv[0] = argv[separator + 1];
	candidate_argv[1] = argv[separator + 2];
	candidate_argv[2] = argv[separator + 3];
	candidate_argv[3] = argv[separator + 4];
	candidate_argv[4] = argv[separator + 5];
	candidate_argv[5] = argv[separator + 6];
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
