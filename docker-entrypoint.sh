#!/bin/sh
set -e

echo "🔧 Quest Planner - Docker Entrypoint"
echo ""

DB_PATH="/app/data/dndplanning.db"

# Only run migrations if database already exists (not a fresh install)
if [ -f "$DB_PATH" ]; then
  echo "📦 Running database migrations..."

  # Run v2 migration (for pre-v3 databases)
  if [ -f "/app/db/migrate-v2-complete.js" ]; then
    node /app/db/migrate-v2-complete.js
  fi

  # Run v3 addon system migration (idempotent)
  if [ -f "/app/db/migrate-v3.js" ]; then
    node /app/db/migrate-v3.js
  fi

  echo ""
else
  echo "📋 No existing database found — fresh install."
  echo "   Database will be created on first server start."
  echo ""
fi

echo "🚀 Starting Quest Planner..."
echo ""

# Start the application
exec node server.js
