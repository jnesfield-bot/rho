#!/usr/bin/env bash
set -e

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "Error: ANTHROPIC_API_KEY is not set"
  echo ""
  echo "Usage:"
  echo "  ANTHROPIC_API_KEY=sk-ant-... ./run.sh"
  exit 1
fi

echo "Building agent-loop container..."
docker build -t agent-loop .

echo "Running agent-loop..."
docker run -it --rm \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -v "$(pwd)/workspace:/workspace" \
  agent-loop
