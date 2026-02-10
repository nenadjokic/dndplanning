const express = require('express');
const { createCanvas, loadImage } = require('canvas');
const db = require('../db/connection');
const router = express.Router();

// Generate Open Graph image for session
router.get('/:id', async (req, res) => {
  try {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);

    if (!session) {
      return res.status(404).send('Session not found');
    }

    // Canvas dimensions (square format for mobile)
    const width = 800;
    const height = 800;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background gradient (dark to darker, Quest Planner style)
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#1a1a2e');
    gradient.addColorStop(1, '#12121f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Add subtle texture overlay
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 80; i++) {
      ctx.fillStyle = '#d4a843';
      ctx.fillRect(
        Math.random() * width,
        Math.random() * height,
        Math.random() * 3,
        Math.random() * 3
      );
    }
    ctx.globalAlpha = 1;

    // Border (gold)
    ctx.strokeStyle = '#d4a843';
    ctx.lineWidth = 6;
    ctx.strokeRect(15, 15, width - 30, height - 30);

    // Vertical layout - centered
    let currentY = 120;

    // 1. Quest Planner Logo (centered, larger)
    try {
      const logo = await loadImage('./public/icons/icon-192.png');
      const logoSize = 180;
      const logoX = (width - logoSize) / 2;

      // Shadow for logo
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 25;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 10;

      // Draw logo with rounded corners
      ctx.save();
      ctx.beginPath();
      ctx.arc(logoX + logoSize/2, currentY + logoSize/2, logoSize/2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(logo, logoX, currentY, logoSize, logoSize);
      ctx.restore();

      // Reset shadow
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      currentY += logoSize + 40;
    } catch (err) {
      console.error('Could not load logo:', err);
      currentY += 60;
    }

    // 2. Quest Planner title
    ctx.fillStyle = '#d4a843';
    ctx.font = 'bold 52px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('QUEST PLANNER', width / 2, currentY);
    currentY += 60;

    // 3. Category badge (centered)
    const categoryText = session.category === 'gamenight' ? 'GAME NIGHT' :
                        session.category === 'rpg' ? 'RPG' :
                        session.category === 'casual' ? 'CASUAL' : 'D&D';

    const badgeWidth = 220;
    const badgeHeight = 55;
    ctx.fillStyle = 'rgba(212, 168, 67, 0.2)';
    ctx.fillRect((width - badgeWidth) / 2, currentY, badgeWidth, badgeHeight);
    ctx.strokeStyle = '#d4a843';
    ctx.lineWidth = 3;
    ctx.strokeRect((width - badgeWidth) / 2, currentY, badgeWidth, badgeHeight);

    ctx.fillStyle = '#f0c850';
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(categoryText, width / 2, currentY + 40);
    currentY += badgeHeight + 50;

    // 4. Session title (centered, word-wrapped, larger)
    ctx.fillStyle = '#e8e6e3';
    ctx.font = 'bold 56px Arial';
    ctx.textAlign = 'center';

    const maxTitleWidth = width - 100;

    // Word wrap title if needed
    const words = session.title.split(' ');
    let line = '';
    const lines = [];

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxTitleWidth && i > 0) {
        lines.push(line.trim());
        line = words[i] + ' ';
      } else {
        line = testLine;
      }
    }
    lines.push(line.trim());

    // Limit to 3 lines for square format
    if (lines.length > 3) {
      lines[2] = lines[2].substring(0, 25) + '...';
      lines.length = 3;
    }

    // Draw title lines
    lines.forEach((line, index) => {
      ctx.fillText(line, width / 2, currentY + (index * 65));
    });
    currentY += (lines.length * 65) + 40;

    // 5. Status and date (centered at bottom)
    if (session.status === 'confirmed' || session.status === 'completed') {
      const slot = db.prepare('SELECT * FROM slots WHERE id = ?').get(session.confirmed_slot_id);
      if (slot) {
        const date = new Date(slot.date_time);
        const dateStr = date.toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        });

        ctx.fillStyle = session.status === 'completed' ? '#3498db' : '#27ae60';
        ctx.font = 'bold 42px Arial';
        ctx.fillText(session.status === 'completed' ? 'COMPLETED' : 'CONFIRMED', width / 2, currentY);

        ctx.fillStyle = '#a8a5a0';
        ctx.font = 'bold 36px Arial';
        ctx.fillText(dateStr, width / 2, currentY + 50);
      }
    } else {
      ctx.fillStyle = '#d4a843';
      ctx.font = 'bold 40px Arial';
      ctx.fillText('Vote for the next session!', width / 2, currentY);
    }

    // Send PNG image
    const buffer = canvas.toBuffer('image/png');
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.send(buffer);

  } catch (error) {
    console.error('Error generating OG image:', error);
    res.status(500).send('Error generating image');
  }
});

module.exports = router;
