/* Cap visible CPU count for Ladybug/Kuzu Database thread pools (ADR-015).
 * Ladybug sizes its process-lifetime pool via hardware_concurrency/get_nprocs;
 * Connection.setMaxNumThreadForExec does not shrink that pool. Under
 * LAMINA_RUNTIME_BOUNDED_TOPOLOGY, graphd preloads this library so each
 * Database opens ~1 worker thread instead of ~ncpu. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <sys/sysinfo.h>
#include <unistd.h>

static long (*real_sysconf)(int) = 0;

long sysconf(int name) {
  if (!real_sysconf) {
    real_sysconf = (long (*)(int))dlsym(RTLD_NEXT, "sysconf");
  }
  if (name == _SC_NPROCESSORS_ONLN || name == _SC_NPROCESSORS_CONF) {
    return 1;
  }
  return real_sysconf ? real_sysconf(name) : 1;
}

int get_nprocs(void) { return 1; }

int get_nprocs_conf(void) { return 1; }
