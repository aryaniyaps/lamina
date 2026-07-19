#!/usr/bin/env python3
import json, os, pathlib, subprocess
root = pathlib.Path('/app')
marker = null
valid = True
if marker == '.lamina':
    valid = (root / '.lamina').exists()
else:
    valid = bool(marker and (root / marker).exists() and (root / marker).stat().st_size > 0)
source = []
for path in root.rglob('*'):
    if path.is_file() and path.suffix in {'.ts','.tsx','.js','.jsx','.mjs','.py','.html','.css'} and 'node_modules' not in path.parts and '.git' not in path.parts:
        source.append(path)
if false:
    valid = valid and bool(source)
result = {'step': "implement", 'arm': "plan", 'marker': marker, 'artifact_valid': bool(valid), 'source_files': len(source)}
pathlib.Path('/logs/verifier').mkdir(parents=True, exist_ok=True)
pathlib.Path('/logs/verifier/reward.json').write_text(json.dumps({'reward': 1.0 if valid else 0.0, **result}, indent=2) + '\n')
print(json.dumps(result))
raise SystemExit(0 if valid else 1)
