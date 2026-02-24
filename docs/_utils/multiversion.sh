#!/bin/bash

cd .. && sphinx-multiversion docs/source docs/_build/dirhtml \
    --pre-build 'cd .. && npm install && npm run js-doc && python docs/_utils/generate_api_pages.py'
