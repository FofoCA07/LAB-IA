#!/usr/bin/env python3
"""Contract tests: every Docker command is intercepted by a local shim."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SHIM = r'''
import json,os,sys
from pathlib import Path
args=sys.argv[1:]
with open(os.environ['SHIM_LOG'],'a') as out:out.write(json.dumps(args)+'\n')
case=os.environ.get('SHIM_CASE','ok')
if case=='docker-error':
 print('private-debug-must-not-escape',file=sys.stderr);sys.exit(17)
if args[0]=='compose':
 assert args[1]=='-p' and args[2]=='docker' and args[3]=='-f'
 command=args[5:]
 if command==['config','--quiet']:pass
 elif command==['ps','-q','opencode-gateway']:print('' if case=='missing-gateway' else 'gw-fixture')
 elif command==['ps','-a','-q','opencode']:print('' if case=='missing-opencode' else 'oc-fixture')
 elif command==['up','-d','--no-deps','--force-recreate','--pull','never','--no-build','opencode']:pass
 elif command==['exec','-T','opencode','ls','-la','/workspace']:print('synthetic files only')
 else:raise AssertionError('Unexpected compose command')
 assert os.environ['LAB_OPENCODE_HOME'].endswith('/.local/share/lab-ia-opencode/home-meta-a')
elif args[:3]==['network','inspect','docker_front']:print('true|false|isolated')
elif args[:3]==['network','inspect','docker_upstream']:print('bridge|false|false')
elif args[0]=='inspect':
 fmt=args[2]
 if '.State.Health' in fmt:print('running|'+('unhealthy' if case=='unhealthy' else 'healthy')+'|2|front|upstream')
 elif fmt.startswith('{{.State.Status}}|'):
  print({'unexpected-network':'running|2|front|0|0','extra-hosts':'running|1|front|1|0','published':'running|1|front|0|1'}.get(case,'running|1|front|0|0'))
 elif fmt.startswith('{{len .NetworkSettings.Networks}}'):print('1|front|0|0')
 elif fmt=='{{.State.Status}}':print('running')
 elif '.Source' in fmt:print(os.environ['SHIM_WORKSPACE'])
 elif '.RW' in fmt:print('true' if case=='rw' else 'false')
 else:raise AssertionError('Unexpected inspect')
else:raise AssertionError('Unexpected docker command')
'''


class Contract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='labia-5b10f-contract-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'repository'
        self.candidate = self.root / 'docker/candidates/5b10d'
        self.candidate.mkdir(parents=True)
        shutil.copyfile(HERE / 'lab-open', self.candidate / 'lab-open')
        shutil.copyfile(HERE / 'compose.yaml', self.candidate / 'compose.yaml')
        self.home = self.base / 'home'
        (self.home / '.local/share/lab-ia-opencode/home-meta-a').mkdir(parents=True)
        self.runtime = self.base / 'runtime'
        self.runtime.mkdir()
        self.workspace = self.base / 'project synthetic'
        self.workspace.mkdir()
        (self.runtime / 'recent-workspaces').write_text(str(self.workspace) + '\n')
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        shim = self.bin / 'docker'
        shim.write_text('#!' + sys.executable + '\n' + SHIM)
        shim.chmod(0o755)
        self.log = self.base / 'docker-calls.jsonl'
        self.env = {'PATH': str(self.bin) + ':/usr/bin:/bin', 'HOME': str(self.home),
                    'LAB_RUNTIME_DIR': str(self.runtime), 'SHIM_LOG': str(self.log),
                    'SHIM_WORKSPACE': str(self.workspace)}

    def invoke(self, case='ok', path=None):
        return subprocess.run(['bash', str(self.candidate / 'lab-open'), str(path or self.workspace)],
                              env={**self.env, 'SHIM_CASE': case}, capture_output=True, text=True, timeout=10)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def assert_no_up(self):
        self.assertFalse(any('up' in call for call in self.calls()))

    def test_backend_single_argument_and_valid_workspace(self):
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        up = [call for call in self.calls() if 'up' in call]
        self.assertEqual(len(up), 1)
        self.assertEqual(up[0][5:], ['up', '-d', '--no-deps', '--force-recreate', '--pull', 'never', '--no-build', 'opencode'])
        self.assertEqual((self.runtime / 'recent-workspaces').read_text(), str(self.workspace) + '\n')
        self.assertIn('Estado de OpenCode: running', result.stdout)

    def test_workspace_missing(self):
        self.assertNotEqual(self.invoke(path=self.base / 'absent').returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_workspace_outside_allowlist(self):
        outside = self.base / 'not approved'; outside.mkdir()
        self.assertNotEqual(self.invoke(path=outside).returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_gateway_missing(self):
        self.assertNotEqual(self.invoke('missing-gateway').returncode, 0); self.assert_no_up()

    def test_gateway_unhealthy(self):
        self.assertNotEqual(self.invoke('unhealthy').returncode, 0); self.assert_no_up()

    def test_unexpected_network_rejected_before_recreation(self):
        self.assertNotEqual(self.invoke('unexpected-network').returncode, 0); self.assert_no_up()

    def test_extra_hosts_rejected_before_recreation(self):
        self.assertNotEqual(self.invoke('extra-hosts').returncode, 0); self.assert_no_up()

    def test_missing_infrastructure_is_not_created(self):
        self.assertNotEqual(self.invoke('missing-opencode').returncode, 0); self.assert_no_up()

    def test_only_opencode_recreated_no_provisioning_or_cleanup_commands(self):
        self.assertEqual(self.invoke().returncode, 0)
        for call in self.calls():
            self.assertFalse(set(call) & {'ollama', 'pull', 'build', 'down', 'prune', 'create', 'connect', '-v'})
        self.assertTrue(any('--no-deps' in call and '--no-build' in call for call in self.calls()))

    def test_docker_errors_are_nonzero_and_sanitized(self):
        result = self.invoke('docker-error')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('private-debug', result.stderr)
        self.assertIn('Error:', result.stderr)
        self.assert_no_up()

    def test_workspace_readonly_enforced_before_recreation(self):
        self.assertNotEqual(self.invoke('rw').returncode, 0); self.assert_no_up()

    def test_published_port_rejected(self):
        self.assertNotEqual(self.invoke('published').returncode, 0); self.assert_no_up()

    def test_new_flag_not_required_or_accepted_as_deployment(self):
        self.assertNotEqual(self.invoke(path='--apply-meta-a').returncode, 0)
        self.assertEqual(self.calls(), [])


if __name__ == '__main__':
    unittest.main()
