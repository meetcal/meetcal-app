#!/bin/bash

# Toggle Offline Mode Script
# Toggles SIMULATE_OFFLINE in config/development.ts

CONFIG_FILE="config/development.ts"

# Check if file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Error: $CONFIG_FILE not found"
    exit 1
fi

# Portable sed in-place editing
TMP_FILE="${CONFIG_FILE}.tmp"

# Check current state
if grep -q "SIMULATE_OFFLINE: true" "$CONFIG_FILE"; then
    # Currently true, set to false
    sed 's/SIMULATE_OFFLINE: true/SIMULATE_OFFLINE: false/g' "$CONFIG_FILE" > "$TMP_FILE" && mv "$TMP_FILE" "$CONFIG_FILE"
    echo "✅ Offline mode DISABLED"
    echo "   App will use real network"
else
    # Currently false, set to true
    sed 's/SIMULATE_OFFLINE: false/SIMULATE_OFFLINE: true/g' "$CONFIG_FILE" > "$TMP_FILE" && mv "$TMP_FILE" "$CONFIG_FILE"
    echo "✅ Offline mode ENABLED"
    echo "   App will simulate offline (no network calls)"
    echo ""
    echo "💡 Next steps:"
    echo "   1. Reload your app (shake device → Reload)"
    echo "   2. Look for '[DEV] Simulating offline mode' in console"
    echo "   3. Orange offline banner should appear"
fi

echo ""
echo "Current config/development.ts:"
grep "SIMULATE_OFFLINE" "$CONFIG_FILE"
