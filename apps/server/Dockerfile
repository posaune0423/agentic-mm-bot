FROM oven/bun:1.2.4

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# First, copy only package.json and lock files needed for dependency installation
COPY package.json bun.lock ./

# Copy package.json files for all workspaces
COPY apps/server/package.json ./apps/server/
COPY packages/db/package.json ./packages/db/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/prettier-config/package.json ./packages/prettier-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/utils/package.json ./packages/utils/

# Install dependencies
RUN bun install

# Copy the application files
COPY . .

# Build the db package (required for runtime)
WORKDIR /app/packages/db
RUN bun run build

# Return to app root
WORKDIR /app

# Expose the port your app runs on
EXPOSE 8787

# Set up environment variable for database connection
# This will be overridden by docker-compose if needed
ENV DATABASE_URL=postgres://postgres:postgres@postgres:5432/postgres
ENV PORT=8787

# Create a script to wait for database and run migrations
RUN cat > /app/start.sh << 'EOF' && chmod +x /app/start.sh
#!/bin/sh
set -e
echo "Waiting for PostgreSQL to be ready..."
until pg_isready -h postgres -U postgres -d postgres; do
  echo "PostgreSQL is unavailable - sleeping"
  sleep 1
done
echo "PostgreSQL is up - executing migrations"
cd /app/packages/db && bun run db:push
echo "Starting server..."
cd /app/apps/server && bun run dev
EOF

# Run the start script
CMD ["/app/start.sh"]
