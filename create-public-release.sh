#!/bin/bash

# Antigravity Stats - Public Release Script
# Creates a clean PUBLIC folder for GitHub without internal files

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLIC_DIR="$SCRIPT_DIR/PUBLIC"

echo "Creating public release folder..."

# Remove old PUBLIC folder if it exists
rm -rf "$PUBLIC_DIR"
mkdir -p "$PUBLIC_DIR"

# Files and folders to exclude from public release
EXCLUDE_PATTERNS=(
    "CHANGELOG.MD"
    "CHANGELOG.md"
    "TODO.md"
    "tek-spec.md"
    ".gemini"
    "node_modules"
    "dist"
    "out"
    "*.vsix"
    ".git"
    "PUBLIC"
    "*.log"
    "READMES"
)

# Build exclude args for rsync
EXCLUDE_ARGS=""
for pattern in "${EXCLUDE_PATTERNS[@]}"; do
    EXCLUDE_ARGS="$EXCLUDE_ARGS --exclude=$pattern"
done

# Copy files using rsync
rsync -av $EXCLUDE_ARGS "$SCRIPT_DIR/" "$PUBLIC_DIR/"

# Create a minimal changelog for public
cat > "$PUBLIC_DIR/CHANGELOG.md" << 'EOF'
# Changelog

## 0.1.0 (Initial Release)

- Real-time quota tracking for AI models
- Dashboard with grouped model display
- Per-model status bar indicators
- Configurable warning and critical thresholds
- Export to JSON/CSV
- Multi-account support
EOF

echo ""
echo "Public release created in: $PUBLIC_DIR"
echo ""
echo "Files excluded:"
for pattern in "${EXCLUDE_PATTERNS[@]}"; do
    echo "  - $pattern"
done
echo ""
echo "Next steps:"
echo "  1. Review the PUBLIC folder"
echo "  2. cd PUBLIC && npm install && npm run build"
echo "  3. Push to GitHub"
