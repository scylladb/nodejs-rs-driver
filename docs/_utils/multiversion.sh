#!/bin/bash

cd .. && sphinx-multiversion docs/source docs/_build/dirhtml \
    --pre-build 'sh -c "npm install && npm run build && npm run js-doc && python docs/_utils/generate_api_pages.py"'
