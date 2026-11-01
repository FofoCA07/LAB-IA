#!/usr/bin/env python3
"""Static release tests. Fixtures live only under the candidate directory."""
import sys
sys.dont_write_bytecode = True
import importlib.util
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import unittest

PACKAGE = Path(__file__).resolve().parent
CANDIDATE = PACKAGE.parent
ROOT = CANDIDATE.parents[2]
spec = importlib.util.spec_from_file_location('contract_fixture', CANDIDATE / 'lab-open.test.py')
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


class PromotedContract(base.Contract):
    def setUp(self):
        super().setUp()
        self.candidate = self.root / 'scripts'
        self.candidate.mkdir()
        shutil.copyfile(PACKAGE / 'files/scripts/lab-open', self.candidate / 'lab-open')
        shutil.copyfile(PACKAGE / 'files/docker/docker-compose.yml', self.root / 'docker/docker-compose.yml')


class PackageChecks(unittest.TestCase):
    def test_source_manifest(self):
        manifest = json.loads((PACKAGE / 'SOURCE_MANIFEST.json').read_text())
        self.assertEqual(manifest['base'], 'b0c4f9b')
        for relative, digest in manifest['sources'].items():
            self.assertEqual(hashlib.sha256((ROOT / relative).read_bytes()).hexdigest(), digest, relative)

    def test_runbook_code_and_links(self):
        for document in PACKAGE.glob('*.md'):
            text = document.read_text()
            for body in re.findall(r'```bash\n(.*?)\n```', text, re.S):
                subprocess.run(['bash', '-n'], input=body, text=True, check=True)
                for python in re.findall(r"<<'PY'\n(.*?)\nPY", body, re.S):
                    compile(python, document.name, 'exec')
                for javascript in re.findall(r"<<'JS'\n(.*?)\nJS", body, re.S):
                    subprocess.run(['node', '--input-type=module', '--check'], input=javascript, text=True, check=True)
            for link in re.findall(r'\]\(([^)]+)\)', text):
                if '://' not in link:
                    self.assertTrue((document.parent / link.split('#')[0]).exists(), link)

    def test_effective_compose_in_final_location(self):
        env = {key: os.environ[key] for key in ['PATH', 'HOME', 'SYSTEMROOT'] if key in os.environ}
        env.update(LAB_WORKSPACE=str(Path.home() / '.local/state/lab-ia-meta-a/acceptance/NOT_CREATED_workspace'),
                   LAB_OPENCODE_HOME=str(Path.home() / '.local/share/lab-ia-opencode/home-meta-a'))
        process = subprocess.run(['docker', 'compose', '--project-directory', str(ROOT / 'docker'),
                                  '-p', 'docker', '-f', str(PACKAGE / 'files/docker/docker-compose.yml'),
                                  'config', '--no-env-resolution', '--format', 'json'],
                                 env=env, capture_output=True, text=True, timeout=15)
        self.assertEqual(process.returncode, 0, process.stderr)
        model = json.loads(process.stdout)
        self.assertEqual(model['name'], 'docker')
        self.assertEqual(set(model['services']), {'opencode', 'opencode-gateway'})
        oc, gw = model['services']['opencode'], model['services']['opencode-gateway']
        self.assertEqual(set(oc['networks']), {'front'})
        self.assertEqual(set(gw['networks']), {'front', 'upstream'})
        self.assertEqual(oc['container_name'], 'opencode')
        self.assertFalse(oc.get('extra_hosts'))
        for service, expected_image in [(oc, 'ghcr.io/anomalyco/opencode@sha256:bf9d0e84b7cedef436a8f57db4d48767cd5d8fc6604f666335c1cc916b199a97'),
                                        (gw, 'docker.io/library/node@sha256:9f0dde62d10e7ff7a310ecaebd66225f6b46c17e6cb778449a77b05d3541bea2')]:
            self.assertEqual(service['image'], expected_image)
            self.assertEqual(service['pull_policy'], 'never')
            self.assertEqual(service['user'], '1000:1000')
            self.assertTrue(service['read_only'])
            self.assertEqual(service['cap_drop'], ['ALL'])
            self.assertEqual(service['security_opt'], ['no-new-privileges:true'])
            self.assertEqual(service['pids_limit'], 256)
            self.assertTrue(service['init'])
            self.assertFalse(service.get('ports'))
            self.assertFalse(service.get('cap_add'))
            self.assertFalse(service.get('privileged'))
            self.assertFalse(service.get('env_file'))
            for volume in service['volumes']:
                self.assertFalse(volume['bind']['create_host_path'])
        mounts = {v['target']: v for v in oc['volumes']}
        self.assertEqual(len(mounts), 4)
        self.assertEqual(mounts['/workspace']['source'], env['LAB_WORKSPACE'])
        self.assertTrue(mounts['/workspace']['read_only'])
        self.assertEqual(mounts['/home/adolf']['source'], env['LAB_OPENCODE_HOME'])
        self.assertFalse(mounts['/home/adolf'].get('read_only', False))
        for target, source in [('/home/adolf/.config/opencode/agents', ROOT / 'agentes/agents'),
                               ('/home/adolf/.config/opencode/opencode.json', ROOT / 'docker/opencode.json')]:
            self.assertEqual(mounts[target]['source'], str(source))
            self.assertTrue(mounts[target]['read_only'])
        gateway_mounts = {v['target']: v for v in gw['volumes']}
        self.assertEqual(len(gateway_mounts), 2)
        self.assertEqual(gateway_mounts['/app/launcher.mjs']['source'], str(ROOT / 'docker/gateway-launcher.mjs'))
        self.assertEqual(gateway_mounts['/app/opencode-gateway.mjs']['source'], str(ROOT / 'proyectos/lab-ia-web/server/opencode-gateway.js'))
        self.assertTrue(all(v['read_only'] for v in gateway_mounts.values()))
        self.assertFalse(any('/candidates/' in v['source'] for s in [oc, gw] for v in s['volumes']))
        self.assertEqual(int(gw['mem_limit']), 268435456)
        self.assertEqual(float(gw['cpus']), 0.5)
        self.assertEqual(gw['networks']['front']['interface_name'], 'front0')
        self.assertEqual(gw['networks']['upstream']['interface_name'], 'upstream0')
        self.assertEqual(gw['networks']['upstream']['gw_priority'], 1)
        self.assertEqual(gw['extra_hosts'], ['host.docker.internal=host-gateway'])
        self.assertEqual(oc['depends_on']['opencode-gateway']['condition'], 'service_healthy')
        self.assertEqual(oc['environment'], {'HOME': '/home/adolf', 'OPENCODE_DISABLE_AUTOUPDATE': 'true',
                                          'OPENCODE_DISABLE_MODELS_FETCH': 'true', 'OPENCODE_DISABLE_DEFAULT_PLUGINS': 'true'})
        self.assertEqual(set(model['networks']), {'front', 'upstream'})
        front, upstream = model['networks']['front'], model['networks']['upstream']
        self.assertEqual(front['name'], 'docker_front')
        self.assertEqual(upstream['name'], 'docker_upstream')
        self.assertTrue(front['internal'])
        self.assertEqual(front['driver_opts'], {'com.docker.network.bridge.gateway_mode_ipv4': 'isolated'})
        for network in [front, upstream]:
            self.assertEqual(network['driver'], 'bridge')
            self.assertTrue(network['enable_ipv4'])
            self.assertFalse(network['enable_ipv6'])
            self.assertFalse(network.get('external'))
            self.assertFalse(network.get('ipam'))
        self.assertFalse(upstream.get('internal', False))
        self.assertFalse(model.get('volumes'))

    def test_provider_and_gateway_are_identical_to_validated_candidates(self):
        for name in ['opencode.json', 'gateway-launcher.mjs']:
            self.assertEqual((PACKAGE / 'files/docker' / name).read_bytes(), (CANDIDATE / name).read_bytes())
        config = json.loads((PACKAGE / 'files/docker/opencode.json').read_text())
        self.assertEqual(config['provider']['ollama']['options']['baseURL'], 'http://opencode-gateway:8080/v1')
        self.assertEqual(config['model'], 'ollama/qwen3:8b')

    def test_daily_script_only_rebases_paths(self):
        source = (CANDIDATE / 'lab-open').read_text()
        start = source.index('if [[ "$script_dir" == */docker/candidates/5b10d ]]')
        end = source.index('runtime_source=xdg-default', start)
        expected = source[:start] + 'lab_root=$(cd -- "$script_dir/.." && pwd -P)\n' + source[end:]
        expected = expected.replace('docker_dir="$candidate_dir"', 'docker_dir="$lab_root/docker"').replace('compose.yaml', 'docker-compose.yml').replace('Compose candidato', 'Compose de LAB-IA').replace('# Candidate: daily workspace selection only; infrastructure must already exist.', '# META A: daily workspace selection only; infrastructure must already exist.')
        actual = (PACKAGE / 'files/scripts/lab-open').read_text()
        self.assertEqual(actual, expected)
        self.assertNotIn('candidates/', actual)
        self.assertNotIn('--apply-meta-a', actual)
        self.assertIn('spawn(labOpenPath, [workspacePath]', (ROOT / 'proyectos/lab-ia-web/server/index.js').read_text())

    def test_syntax_without_running_cutover(self):
        subprocess.run(['bash', '-n', str(PACKAGE / 'files/scripts/lab-open')], check=True)
        subprocess.run(['node', '--check', str(PACKAGE / 'files/docker/gateway-launcher.mjs')], check=True)
        compile((PACKAGE / 'prepare_home.py').read_text(), 'prepare_home.py', 'exec')
        compile((PACKAGE / 'snapshot.py').read_text(), 'snapshot.py', 'exec')
        compile((PACKAGE / 'accept_reviewer.py').read_text(), 'accept_reviewer.py', 'exec')
        subprocess.run([sys.executable, str(PACKAGE / 'prepare_home.py'), '--help'], stdout=subprocess.DEVNULL, check=True)
        subprocess.run([sys.executable, str(PACKAGE / 'accept_reviewer.py'), '--help'], stdout=subprocess.DEVNULL, check=True)


if __name__ == '__main__':
    unittest.main()
