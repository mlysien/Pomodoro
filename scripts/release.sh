#!/bin/bash

# Release script for Pomodoro Timer App

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Pomodoro Timer App Release Script${NC}"

# Check if version is provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: Please provide a version number (e.g., 1.0.0)${NC}"
    echo "Usage: ./scripts/release.sh <version>"
    exit 1
fi

VERSION=$1

echo -e "${YELLOW}📦 Preparing release for version $VERSION${NC}"

# Update version in package.json
cd pomodoro-tauri
npm version $VERSION --no-git-tag-version

# Update version in tauri.conf.json
sed -i "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" src-tauri/tauri.conf.json

cd ..

# Create git tag
git add .
git commit -m "Release version $VERSION"
git tag -a "v$VERSION" -m "Release version $VERSION"

echo -e "${GREEN}✅ Version $VERSION prepared successfully!${NC}"
echo -e "${YELLOW}📝 To create a release:${NC}"
echo "1. Push the tag: git push origin v$VERSION"
echo "2. The GitHub Action will automatically build and create a release"
echo ""
echo -e "${GREEN}🎉 Happy releasing!${NC}" 