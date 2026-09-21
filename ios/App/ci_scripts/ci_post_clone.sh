#!/bin/sh
set -e

echo "Installing Node.js (not included in Xcode Cloud by default)..."
NODE_VERSION="20.18.1"
curl -fsSL -O "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz"
tar -xzf "node-v${NODE_VERSION}-darwin-arm64.tar.gz"
export PATH="$PWD/node-v${NODE_VERSION}-darwin-arm64/bin:$PATH"

echo "Node version: $(node -v)"
echo "npm version: $(npm -v)"

echo "Installing npm dependencies..."
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm install

echo "Building the web app..."
npm run build

echo "Syncing Capacitor (copies the web build and config into the iOS project)..."
npx cap sync ios

echo "Installing CocoaPods dependencies..."
cd "$CI_PRIMARY_REPOSITORY_PATH/ios/App"
pod install
