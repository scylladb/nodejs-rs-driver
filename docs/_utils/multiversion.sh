#!/bin/bash

cd .. && sphinx-multiversion docs/source docs/_build/dirhtml \
    --pre-build 'sh -c "npm install && (./node_modules/.bin/tsc -p tsconfig.build.json --noEmitOnError false || true) && npm run js-doc && python docs/_utils/generate_api_pages.py"'
