#!/bin/bash
echo "Building 'claoude-vm'"
(cd claoude-vm/ && pnpm run build)

echo "Building 'web-server'"
(cd web-server/ && pnpm run build)
