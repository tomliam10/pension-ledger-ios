#!/bin/sh
set -e

echo "Installing npm dependencies..."
cd "$CI_PRIMARY_REPOSITORY_PATH"
npm install

echo "Installing CocoaPods dependencies..."
cd "$CI_PRIMARY_REPOSITORY_PATH/ios/App"
pod install
