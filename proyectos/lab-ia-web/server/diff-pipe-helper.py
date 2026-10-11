"""Bounded binary stdin -> anonymous Unix pipes -> Git stdout. No file writes."""
import os
import signal
import subprocess
import sys
import threading

MAX_CONTENT = 16 * 1024
MAX_OUTPUT = 128 * 1024


def terminate(_signal, _frame):
    # Unwind main so finally closes descriptors and reaps Git before exiting.
    raise TimeoutError()


def read_exact(size):
    data = bytearray()
    while len(data) < size:
        chunk = sys.stdin.buffer.read(size - len(data))
        if not chunk:
            raise ValueError()
        data.extend(chunk)
    return bytes(data)


def main():
    header = read_exact(8)
    old_size = int.from_bytes(header[:4], 'big')
    new_size = int.from_bytes(header[4:], 'big')
    if old_size > MAX_CONTENT or new_size > MAX_CONTENT:
        raise ValueError()
    old = read_exact(old_size)
    new = read_exact(new_size)
    if sys.stdin.buffer.read(1):
        raise ValueError()
    for data in (old, new):
        if b'\0' in data:
            raise ValueError()
        data.decode('utf-8', errors='strict')
    fds = set()
    threads = []
    writer_errors = []
    process = None

    def close(fd):
        if fd in fds:
            fds.remove(fd)
            os.close(fd)

    def write_all(fd, data):
        try:
            view = memoryview(data)
            while view:
                count = os.write(fd, view)
                if count <= 0:
                    raise ValueError()
                view = view[count:]
        except Exception:
            writer_errors.append(True)
        finally:
            close(fd)

    try:
        old_read, old_write = os.pipe()
        fds.update((old_read, old_write))
        new_read, new_write = os.pipe()
        fds.update((new_read, new_write))
        os.set_inheritable(old_read, True)
        os.set_inheritable(new_read, True)
        args = ['git', '--no-pager', '-c', 'core.attributesFile=/dev/null',
                '-c', 'diff.suppressBlankEmpty=false', 'diff', '--no-index',
                '--patch', '--text', '--no-ext-diff', '--no-textconv', '--no-renames',
                '--no-color', '--no-relative', '--diff-algorithm=myers',
                '--no-indent-heuristic', '--unified=3', '--src-prefix=a/',
                '--dst-prefix=b/', '--', f'/proc/self/fd/{old_read}',
                f'/proc/self/fd/{new_read}']
        env = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C',
               'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1',
               'GIT_ATTR_NOSYSTEM': '1'}
        process = subprocess.Popen(args, shell=False, close_fds=True,
                                   pass_fds=(old_read, new_read), cwd='/', env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        close(old_read)
        close(new_read)
        for fd, data in ((old_write, old), (new_write, new)):
            thread = threading.Thread(target=write_all, args=(fd, data))
            threads.append(thread)
            thread.start()
        output = process.stdout.read(MAX_OUTPUT + 1)
        if len(output) > MAX_OUTPUT:
            raise ValueError()
        code = process.wait()
        for thread in threads:
            thread.join()
        if writer_errors or code not in (0, 1):
            raise ValueError()
        sys.stdout.buffer.write(output)
        sys.stdout.buffer.flush()
        return code
    finally:
        if process is not None:
            if process.poll() is None:
                process.kill()
            process.wait()
            process.stdout.close()
        for thread in threads:
            thread.join()
        for fd in tuple(fds):
            close(fd)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, terminate)
    try:
        result = main()
    except BaseException:
        result = 2
    sys.exit(result)
