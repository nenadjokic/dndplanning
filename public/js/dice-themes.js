/* === Dice Theme System — 4 premium themes for 3D dice ===
 * Themes are INDEPENDENT from website theme (dark/light).
 * Each dice theme has dark & light variants for minor contrast adjustments.
 * Stored in localStorage — no database changes needed.
 */

var DICE_THEMES = {
  'tavern-oak': {
    name: 'Tavern Oak',
    description: 'Classic wooden tavern dice',
    dark: {
      bodyColor: '#6b4423',
      numberColor: '#f0d9a0',
      edgeColor: '#5a3818',
      roughness: 0.5,
      metalness: 0.15,
      materialType: 'standard',
      flatShading: true,
      font: 'MedievalSharp, cursive',
      lighting: {
        ambient: { color: 0xffffff, intensity: 1.2 },
        directional: { color: 0xffffff, intensity: 0.8 },
        point: { color: 0xd4a843, intensity: 0.5, distance: 20 }
      },
      sound: { filterFreq: 800, filterQ: 1.5, oscFreq: 120, character: 'wood' }
    },
    light: {
      bodyColor: '#8b6233',
      numberColor: '#2a1a0a',
      edgeColor: '#7a5828',
      lighting: {
        ambient: { color: 0xffffff, intensity: 1.4 },
        directional: { color: 0xffffff, intensity: 1.0 },
        point: { color: 0xd4a843, intensity: 0.3, distance: 20 }
      }
    }
  },

  'crystal-arcane': {
    name: 'Crystal Arcane',
    description: 'Translucent magical crystal',
    dark: {
      bodyColor: '#4a3a6e',
      numberColor: '#e0d0ff',
      edgeColor: '#3a2a5e',
      roughness: 0.1,
      metalness: 0.0,
      materialType: 'physical',
      flatShading: false,
      font: 'MedievalSharp, cursive',
      // MeshPhysicalMaterial extras
      transmission: 0.4,
      thickness: 0.5,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      ior: 1.5,
      lighting: {
        ambient: { color: 0xe8e0ff, intensity: 1.0 },
        directional: { color: 0xffffff, intensity: 1.2 },
        point: { color: 0x9966ff, intensity: 0.8, distance: 20 }
      },
      sound: { filterFreq: 2000, filterQ: 3.0, oscFreq: 400, character: 'crystal' }
    },
    light: {
      bodyColor: '#6a5a8e',
      numberColor: '#1a0a3a',
      edgeColor: '#5a4a7e',
      transmission: 0.3,
      lighting: {
        ambient: { color: 0xffffff, intensity: 1.4 },
        directional: { color: 0xffffff, intensity: 1.0 },
        point: { color: 0x7744cc, intensity: 0.4, distance: 20 }
      }
    }
  },

  'obsidian-crypt': {
    name: 'Obsidian Crypt',
    description: 'Dark volcanic glass with blood-red numbers',
    dark: {
      bodyColor: '#1a1a1a',
      numberColor: '#ff4444',
      edgeColor: '#2a2a2a',
      roughness: 0.2,
      metalness: 0.4,
      materialType: 'standard',
      flatShading: true,
      font: 'MedievalSharp, cursive',
      lighting: {
        ambient: { color: 0xffffff, intensity: 0.8 },
        directional: { color: 0xffffff, intensity: 1.0 },
        point: { color: 0xff4444, intensity: 0.6, distance: 20 }
      },
      sound: { filterFreq: 600, filterQ: 2.0, oscFreq: 80, character: 'stone' }
    },
    light: {
      bodyColor: '#2a2a2a',
      numberColor: '#cc0000',
      edgeColor: '#3a3a3a',
      lighting: {
        ambient: { color: 0xffffff, intensity: 1.2 },
        directional: { color: 0xffffff, intensity: 1.2 },
        point: { color: 0xff4444, intensity: 0.3, distance: 20 }
      }
    }
  },

  'golden-hoard': {
    name: 'Golden Hoard',
    description: 'Gleaming dragon treasure gold',
    dark: {
      bodyColor: '#c9a84c',
      numberColor: '#1a1a1a',
      edgeColor: '#a88a3c',
      roughness: 0.25,
      metalness: 0.85,
      materialType: 'standard',
      flatShading: true,
      font: 'MedievalSharp, cursive',
      lighting: {
        ambient: { color: 0xfff8e0, intensity: 1.0 },
        directional: { color: 0xffffff, intensity: 1.0 },
        point: { color: 0xffd700, intensity: 0.7, distance: 20 }
      },
      sound: { filterFreq: 1200, filterQ: 2.5, oscFreq: 200, character: 'metal' }
    },
    light: {
      bodyColor: '#b89840',
      numberColor: '#2a2a2a',
      edgeColor: '#987a30',
      lighting: {
        ambient: { color: 0xffffff, intensity: 1.4 },
        directional: { color: 0xffffff, intensity: 1.2 },
        point: { color: 0xdaa520, intensity: 0.3, distance: 20 }
      }
    }
  },

  'marble-palace': {
    name: 'Marble Palace',
    description: 'Polished white marble with gold ink',
    dark: {
      bodyColor: '#e8e0d4',
      numberColor: '#c9a84c',
      edgeColor: '#d4cfc5',
      roughness: 0.15,
      metalness: 0.0,
      materialType: 'physical',
      flatShading: false,
      font: 'MedievalSharp, cursive',
      clearcoat: 0.6,
      clearcoatRoughness: 0.15,
      lighting: {
        ambient: { color: 0xffffff, intensity: 1.2 },
        directional: { color: 0xffffff, intensity: 1.0 },
        point: { color: 0xfff5e0, intensity: 0.4, distance: 20 }
      },
      sound: { filterFreq: 1000, filterQ: 2.0, oscFreq: 150, character: 'stone' }
    },
    light: {
      bodyColor: '#f0ebe0',
      numberColor: '#8b6b30',
      edgeColor: '#e0dbd0',
      lighting: {
        ambient: { color: 0xffffff, intensity: 1.4 },
        directional: { color: 0xffffff, intensity: 1.2 },
        point: { color: 0xfff5e0, intensity: 0.3, distance: 20 }
      }
    }
  },

  'magma-forge': {
    name: 'Magma Forge',
    description: 'Volcanic rock with molten lava glow',
    dark: {
      bodyColor: '#1a1010',
      numberColor: '#ffaa00',
      edgeColor: '#2a1515',
      roughness: 0.85,
      metalness: 0.1,
      materialType: 'standard',
      flatShading: true,
      font: 'MedievalSharp, cursive',
      emissive: '#ff3300',
      emissiveIntensity: 0.15,
      lighting: {
        ambient: { color: 0xffffff, intensity: 0.6 },
        directional: { color: 0xffffff, intensity: 0.8 },
        point: { color: 0xff4400, intensity: 0.8, distance: 20 }
      },
      sound: { filterFreq: 600, filterQ: 2.0, oscFreq: 80, character: 'stone' }
    },
    light: {
      bodyColor: '#2a1818',
      numberColor: '#ff8800',
      edgeColor: '#3a2020',
      emissiveIntensity: 0.1,
      lighting: {
        ambient: { color: 0xffffff, intensity: 1.0 },
        directional: { color: 0xffffff, intensity: 1.0 },
        point: { color: 0xff4400, intensity: 0.5, distance: 20 }
      }
    }
  },

  'smoke-nebula': {
    name: 'Smoke Nebula',
    description: 'Deep space nebula with cosmic glow',
    dark: {
      bodyColor: '#1a1033',
      numberColor: '#e0e8ff',
      edgeColor: '#150d2a',
      roughness: 0.05,
      metalness: 0.0,
      materialType: 'physical',
      flatShading: false,
      font: 'MedievalSharp, cursive',
      transmission: 0.35,
      thickness: 0.8,
      clearcoat: 0.9,
      clearcoatRoughness: 0.05,
      ior: 1.45,
      lighting: {
        ambient: { color: 0xe0e0ff, intensity: 1.0 },
        directional: { color: 0xffffff, intensity: 1.2 },
        point: { color: 0x6644ff, intensity: 0.6, distance: 20 }
      },
      sound: { filterFreq: 2000, filterQ: 3.0, oscFreq: 400, character: 'crystal' }
    },
    light: {
      bodyColor: '#2a1a4a',
      numberColor: '#1a0a3a',
      edgeColor: '#221440',
      transmission: 0.25,
      lighting: {
        ambient: { color: 0xffffff, intensity: 1.4 },
        directional: { color: 0xffffff, intensity: 1.0 },
        point: { color: 0x4422aa, intensity: 0.4, distance: 20 }
      }
    }
  },

  'frost-shard': {
    name: 'Frost Shard',
    description: 'Frozen ice with crystalline shimmer',
    dark: {
      bodyColor: '#c8e8ff',
      numberColor: '#1a3a5a',
      edgeColor: '#a0d0f0',
      roughness: 0.15,
      metalness: 0.0,
      materialType: 'physical',
      flatShading: false,
      font: 'MedievalSharp, cursive',
      transmission: 0.5,
      thickness: 1.0,
      clearcoat: 0.8,
      clearcoatRoughness: 0.1,
      ior: 1.31,
      lighting: {
        ambient: { color: 0xe0f0ff, intensity: 1.2 },
        directional: { color: 0xffffff, intensity: 1.3 },
        point: { color: 0x88ccff, intensity: 0.5, distance: 20 }
      },
      sound: { filterFreq: 2200, filterQ: 3.5, oscFreq: 500, character: 'crystal' }
    },
    light: {
      bodyColor: '#d8f0ff',
      numberColor: '#2a4a6a',
      edgeColor: '#b8e0f8',
      transmission: 0.4,
      lighting: {
        ambient: { color: 0xffffff, intensity: 1.4 },
        directional: { color: 0xffffff, intensity: 1.2 },
        point: { color: 0x88ccff, intensity: 0.3, distance: 20 }
      }
    }
  },

  'blood-chalice': {
    name: 'Blood Chalice',
    description: 'Dark crimson vampire dice',
    dark: {
      bodyColor: '#4a0a0a',
      numberColor: '#d4af37',
      edgeColor: '#3a0505',
      roughness: 0.2,
      metalness: 0.05,
      materialType: 'physical',
      flatShading: false,
      font: 'MedievalSharp, cursive',
      transmission: 0.2,
      thickness: 0.6,
      clearcoat: 0.7,
      clearcoatRoughness: 0.1,
      ior: 1.5,
      lighting: {
        ambient: { color: 0xffe8e8, intensity: 0.7 },
        directional: { color: 0xffffff, intensity: 0.9 },
        point: { color: 0xff2222, intensity: 0.5, distance: 20 }
      },
      sound: { filterFreq: 700, filterQ: 2.0, oscFreq: 100, character: 'stone' }
    },
    light: {
      bodyColor: '#5a1515',
      numberColor: '#c9a84c',
      edgeColor: '#4a0a0a',
      transmission: 0.15,
      lighting: {
        ambient: { color: 0xffffff, intensity: 1.2 },
        directional: { color: 0xffffff, intensity: 1.0 },
        point: { color: 0xff2222, intensity: 0.3, distance: 20 }
      }
    }
  },

  'forest-druid': {
    name: 'Forest Druid',
    description: 'Ancient moss and bark of the old woods',
    dark: {
      bodyColor: '#2d5a1e',
      numberColor: '#d4af37',
      edgeColor: '#244a16',
      roughness: 0.6,
      metalness: 0.05,
      materialType: 'standard',
      flatShading: true,
      font: 'MedievalSharp, cursive',
      lighting: {
        ambient: { color: 0xf0ffe0, intensity: 1.1 },
        directional: { color: 0xffffff, intensity: 0.9 },
        point: { color: 0xd4a843, intensity: 0.6, distance: 20 }
      },
      sound: { filterFreq: 800, filterQ: 1.5, oscFreq: 120, character: 'wood' }
    },
    light: {
      bodyColor: '#3a6a28',
      numberColor: '#2a1a0a',
      edgeColor: '#305a1e',
      lighting: {
        ambient: { color: 0xffffff, intensity: 1.4 },
        directional: { color: 0xffffff, intensity: 1.0 },
        point: { color: 0x88cc44, intensity: 0.3, distance: 20 }
      }
    }
  },

  'celestial-star': {
    name: 'Celestial Star',
    description: 'Starry night sky with golden glitter',
    dark: {
      bodyColor: '#0a0a1e',
      numberColor: '#ffd700',
      edgeColor: '#08081a',
      roughness: 0.1,
      metalness: 0.15,
      materialType: 'physical',
      flatShading: false,
      font: 'MedievalSharp, cursive',
      clearcoat: 0.9,
      clearcoatRoughness: 0.05,
      lighting: {
        ambient: { color: 0x0a0a2a, intensity: 0.5 },
        directional: { color: 0xffffff, intensity: 1.2 },
        point: { color: 0xffffff, intensity: 1.0, distance: 20 }
      },
      sound: { filterFreq: 2000, filterQ: 3.0, oscFreq: 400, character: 'crystal' }
    },
    light: {
      bodyColor: '#141428',
      numberColor: '#daa520',
      edgeColor: '#101020',
      lighting: {
        ambient: { color: 0xffffff, intensity: 1.0 },
        directional: { color: 0xffffff, intensity: 1.0 },
        point: { color: 0x4444ff, intensity: 0.3, distance: 20 }
      }
    }
  },

  'dragon-scale': {
    name: 'Dragon Scale',
    description: 'Ancient brass dragon treasure',
    dark: {
      bodyColor: '#8b7536',
      numberColor: '#1a1a1a',
      edgeColor: '#6b5a28',
      roughness: 0.35,
      metalness: 0.9,
      materialType: 'standard',
      flatShading: true,
      font: 'MedievalSharp, cursive',
      lighting: {
        ambient: { color: 0xfff8e0, intensity: 0.9 },
        directional: { color: 0xffffff, intensity: 1.3 },
        point: { color: 0xffd700, intensity: 0.7, distance: 20 }
      },
      sound: { filterFreq: 1200, filterQ: 2.5, oscFreq: 200, character: 'metal' }
    },
    light: {
      bodyColor: '#9b8540',
      numberColor: '#2a2a2a',
      edgeColor: '#7b6530',
      lighting: {
        ambient: { color: 0xffffff, intensity: 1.4 },
        directional: { color: 0xffffff, intensity: 1.2 },
        point: { color: 0xdaa520, intensity: 0.3, distance: 20 }
      }
    }
  }
};

/* ── Dice Theme Manager ── */
var DiceThemeManager = {
  currentTheme: 'tavern-oak',

  init: function() {
    this.currentTheme = localStorage.getItem('diceTheme') || 'tavern-oak';
    // Validate stored theme still exists
    if (!DICE_THEMES[this.currentTheme]) {
      this.currentTheme = 'tavern-oak';
    }
  },

  // Get the active theme config, merged with correct dark/light variant
  getConfig: function() {
    var theme = DICE_THEMES[this.currentTheme];
    if (!theme) theme = DICE_THEMES['tavern-oak'];

    // Detect website theme for minor adjustments
    var webTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    var isLight = (webTheme === 'light');
    var base = theme.dark;
    var override = isLight ? (theme.light || {}) : {};

    // Deep merge: base + override (one level deep for lighting)
    var config = {};
    for (var key in base) {
      if (base.hasOwnProperty(key)) {
        if (key === 'lighting' && override.lighting) {
          config.lighting = {};
          for (var lk in base.lighting) {
            if (base.lighting.hasOwnProperty(lk)) {
              config.lighting[lk] = Object.assign({}, base.lighting[lk], (override.lighting[lk] || {}));
            }
          }
        } else {
          config[key] = override.hasOwnProperty(key) ? override[key] : base[key];
        }
      }
    }
    return config;
  },

  setTheme: function(themeId) {
    if (!DICE_THEMES[themeId]) return;
    this.currentTheme = themeId;
    localStorage.setItem('diceTheme', themeId);
  },

  getThemeList: function() {
    var list = [];
    for (var id in DICE_THEMES) {
      if (DICE_THEMES.hasOwnProperty(id)) {
        list.push({ id: id, name: DICE_THEMES[id].name, description: DICE_THEMES[id].description });
      }
    }
    return list;
  }
};

// Initialize on load
DiceThemeManager.init();

// Export for use by dice-roller.js
window.DiceThemeManager = DiceThemeManager;
window.DICE_THEMES = DICE_THEMES;
