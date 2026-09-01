#!/bin/sh
set -e

echo "Installing Node.js (not included in Xcode Cloud by default)..."
export HOMEBREW_NO_INSTALL_CLEANUP=TRUE
brew install node@20
brew link --force node@20

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
