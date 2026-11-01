#!/bin/bash
#
# Wrapper para MySecrets Native Messaging Host
# Garante que o Node.js seja encontrado independentemente do PATH
#

# Caminho do Node.js (mise)
NODE_PATH="/home/ancalagon/.local/share/mise/installs/node/20.19.5/bin/node"

# Caminho do script
SCRIPT_DIR="$(dirname "$0")"
HOST_SCRIPT="$SCRIPT_DIR/mysecrets-host.js"

# Verifica se Node.js existe
if [ ! -f "$NODE_PATH" ]; then
    # Fallback: tenta encontrar node no PATH
    NODE_PATH=$(which node 2>/dev/null)
    
    if [ -z "$NODE_PATH" ]; then
        echo "Erro: Node.js não encontrado" >&2
        exit 1
    fi
fi

# Executa o script
exec "$NODE_PATH" "$HOST_SCRIPT"
