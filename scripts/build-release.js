/**
 * Build Release Package
 * Creates a ZIP file ready for web server deployment with web-based installer
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packageJson = require('../package.json');
const version = packageJson.version;

const releaseDir = path.join(__dirname, '..', 'releases');
const tempDir = path.join(releaseDir, 'temp-build');
const zipName = `quest-planner-v${version}-web-installer.zip`;
const zipPath = path.join(releaseDir, zipName);

// Files and directories to EXCLUDE from the release
const excludePatterns = [
  'node_modules',
  '.git',
  '.github',
  '.claude',
  'releases',
  'data',
  '.env',
  '.DS_Store',
  '*.log',
  'test-*.js',
  '*.spec.js',
  '*.test.js',
  'e2e',
  'playwright.config.*',
  '.playwright-mcp',
  'screenshots',
  'docs',
  '*.bak',
  '.gitignore',
  'CLAUDE.md'
];

// Files to INCLUDE (everything else)
const includeFiles = [
  'server.js',
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'db',
  'helpers',
  'middleware',
  'public',
  'routes',
  'views',
  'scripts'
];

console.log('🎁 Building Quest Planner Web Installer Release Package...\n');

// Create releases directory
if (!fs.existsSync(releaseDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
}

// Clean up old temp directory
if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// Create temp build directory
fs.mkdirSync(tempDir, { recursive: true });

console.log('📦 Copying files...');

// Function to check if path should be excluded
function shouldExclude(filePath) {
  const relativePath = path.relative(path.join(__dirname, '..'), filePath);
  return excludePatterns.some(pattern => {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(path.basename(filePath)) || regex.test(relativePath);
    }
    return relativePath.includes(pattern) || path.basename(filePath) === pattern;
  });
}

// Recursive copy function
function copyRecursive(src, dest) {
  if (shouldExclude(src)) {
    return;
  }

  const stat = fs.statSync(src);

  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

// Copy all included files
const rootDir = path.join(__dirname, '..');
for (const item of includeFiles) {
  const srcPath = path.join(rootDir, item);
  const destPath = path.join(tempDir, item);

  if (fs.existsSync(srcPath)) {
    copyRecursive(srcPath, destPath);
    console.log(`  ✓ ${item}`);
  }
}

// Create empty data directory with .gitkeep
const dataDir = path.join(tempDir, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
fs.writeFileSync(path.join(dataDir, '.gitkeep'), '');

// Create .env.example
const envExample = `# Quest Planner Configuration
# Copy this file to .env and configure for your environment

# Application
NODE_ENV=production
PORT=3000
APP_NAME=Quest Planner

# Session Secret (generate a random string)
SESSION_SECRET=your-secret-key-here-change-this

# Security (set to true if behind reverse proxy with HTTPS)
TRUST_PROXY=false
SECURE_COOKIES=false

# Database path (relative to project root)
DB_PATH=./data/dndplanning.db

# Note: If you use the web installer, these will be auto-generated
`;

fs.writeFileSync(path.join(tempDir, '.env.example'), envExample);

// Create INSTALL.md
const installMd = `# Quest Planner - Installation Guide

## Quick Start (Web-Based Installer)

1. **Extract the ZIP file** to your web server directory

2. **Install Node.js dependencies:**
   \`\`\`bash
   npm install
   \`\`\`

3. **Start the server:**
   \`\`\`bash
   npm start
   \`\`\`

4. **Open your browser** and navigate to:
   \`\`\`
   http://localhost:3000/install
   \`\`\`

5. **Follow the installation wizard** to:
   - Create an admin account
   - Configure application settings
   - Set up the database

6. **Restart the server** after installation:
   \`\`\`bash
   # Stop the server (Ctrl+C)
   npm start
   \`\`\`

## Requirements

- **Node.js**: Version 14 or higher
- **npm**: Comes with Node.js
- **Port**: 3000 (configurable via .env)

## Manual Installation (Advanced)

If you prefer manual setup:

1. Copy \`.env.example\` to \`.env\` and configure
2. Create database: \`node db/init.js\`
3. Create admin user manually via SQL
4. Start server: \`npm start\`

## Production Deployment

### With Reverse Proxy (Nginx, Apache)

If running behind HTTPS reverse proxy, update \`.env\`:

\`\`\`env
TRUST_PROXY=true
SECURE_COOKIES=true
\`\`\`

### Process Manager (PM2)

For production, use a process manager like PM2:

\`\`\`bash
npm install -g pm2
pm2 start server.js --name quest-planner
pm2 save
pm2 startup
\`\`\`

## Troubleshooting

### "Cannot find module" errors

Run \`npm install\` to install dependencies.

### Permission denied (data directory)

Ensure the Node.js process has write permissions to the \`data/\` directory:

\`\`\`bash
chmod 755 data
\`\`\`

### Port already in use

Change the port in \`.env\`:

\`\`\`env
PORT=8080
\`\`\`

## Support

- **Documentation**: https://github.com/nenadjokic/dndplanning
- **Issues**: https://github.com/nenadjokic/dndplanning/issues
- **License**: GPL-3.0

---

**Quest Planner v${version}** - D&D Session Planning Made Easy
`;

fs.writeFileSync(path.join(tempDir, 'INSTALL.md'), installMd);

console.log('  ✓ .env.example');
console.log('  ✓ INSTALL.md');
console.log('  ✓ data/ (empty)');

// Create ZIP file
console.log('\n📦 Creating ZIP archive...');

try {
  // Remove old ZIP if exists
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  // Create ZIP using system zip command (works on Unix/Mac, requires zip on Windows)
  const cwd = releaseDir;
  execSync(`cd temp-build && zip -r ../${zipName} . -x "*.DS_Store"`, { cwd, stdio: 'inherit' });

  console.log(`\n✅ Release package created successfully!\n`);
  console.log(`📦 Package: ${zipName}`);
  console.log(`📁 Location: ${zipPath}`);
  console.log(`📊 Size: ${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(2)} MB\n`);

  // Clean up temp directory
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log('🎉 Ready for distribution!');
  console.log('   Upload this ZIP to your GitHub release.\n');

} catch (error) {
  console.error('\n❌ Error creating ZIP:', error.message);
  console.error('   Make sure "zip" command is available on your system.');
  process.exit(1);
}
