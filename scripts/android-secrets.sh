#!/usr/bin/env bash
# Envia a chave de assinatura do app Android para os secrets do GitHub
# (o workflow Build usa para assinar o APK da release).
#
# A chave fica em ~/.config/mysecrets-android/ — FAÇA BACKUP dessa pasta:
# sem a mesma chave, o Android não aceita instalar atualizações por cima.
set -euo pipefail
REPO="${1:-plugato/mySecrets}"
D="$HOME/.config/mysecrets-android"
PW="$(grep '^storePassword=' "$D/keystore.properties" | cut -d= -f2-)"
ALIAS="$(grep '^keyAlias=' "$D/keystore.properties" | cut -d= -f2-)"
base64 -w0 "$D/release.jks" | gh secret set ANDROID_KEYSTORE_BASE64 -R "$REPO"
printf '%s' "$PW" | gh secret set ANDROID_KEYSTORE_PASSWORD -R "$REPO"
printf '%s' "$PW" | gh secret set ANDROID_KEY_PASSWORD -R "$REPO"
printf '%s' "$ALIAS" | gh secret set ANDROID_KEY_ALIAS -R "$REPO"
echo "Secrets ANDROID_* gravados em $REPO"
