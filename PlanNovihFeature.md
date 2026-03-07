# Quest Planner — Strateški Plan Novih Feature-a

## Analiza Pozicije na Tržištu

Quest Planner zauzima **jedinstvenu nišu** koju nijedan drugi alat ne pokriva:

| Konkurent | Šta rade dobro | Šta Quest Planner ima a oni nemaju |
|-----------|---------------|-------------------------------------|
| **Roll20** | VTT, marketplace, 12M korisnika | Session scheduling, community board, self-hosted, free |
| **D&D Beyond** | Character builder, official content | Scheduling, maps, self-hosted, community features |
| **Foundry VTT** | Moduli, dynamic lighting, $50 once | Scheduling, community, loot tracker, analitika |
| **Owlbear Rodeo** | Jednostavnost, <1 min setup | Persistence, scheduling, community, NPCs |
| **5e.tools** | Besplatna referenca za sve | Maps, scheduling, social features |
| **Tabletop Time** | RPG scheduling | Maps, community, NPCs, loot, dice |
| **Kanka/LegendKeeper** | Campaign wikis | Maps s tokenima, scheduling, dice, real-time |

**Ključni insight:** Nijedan alat ne kombinuje session scheduling + campaign management + maps + community u jednom self-hosted paketu. To je naša prednost.

---

## TIER 1: Kritični Feature-i (Pokreću Usvajanje)

### 1. Initiative & Combat Tracker (integrisano u mapu) --- DONE (v2.0.13)

**Status:** IMPLEMENTIRANO

**Implementirano:**
- ⚔️ Combat button na mapi (normal + fullscreen toolbar) — DM only
- **Sword Selection Mode** — DM klikne Combat, klikne tokene da ih doda/skine (crosshair kursor, pulsing gold highlight)
- **Floating draggable Combat Panel** — turn order, round counter, active turn highlight (gold border + ▶ arrow)
- **Initiative system** — ručni unos ILI 🎲 Roll All auto-roll (1d20 + DEX modifier iz monster data)
- **Active Token Indicator** — pulsing gold ring na mapi oko tokena čiji je red
- **HP kontrole** u panelu — +/− damage/heal dugmad za NPC-ove (reuse postojećeg HP endpoint-a)
- **Legendary Actions** — counter (X/Y) sa use/reset, auto-reset na novi round
- **Condition Duration Tracking** — duration_rounds + duration_type (start_of_turn / end_of_turn / indefinite), auto-decrement na next turn
- **Player Visibility** — DM bira: Full / Order Only / Hidden (per-encounter)
- **Mid-Combat Add/Remove** — dodaj/skini tokene tokom borbe (+ Add dugme sa vizuelnim feedback-om)
- **Real-time SSE sync** — `combat-update` event, svi igrači vide panel u real-time
- **Page Load Restore** — combat se automatski učitava ako je aktivan na mapi
- **End Combat** — sačuva finalno stanje (HP, conditions), obriše combat podatke
- **ESC key** za cancel selection/add mode
- **Responsive** — panel se dockuje na dno na mobilnom (< 768px)
- DB: `combat_encounters` + `combat_participants` tabele, `duration_rounds`/`duration_type` kolone na condition tabelama
- Migracija: `db/migrate-v2-complete.js` ažuriran (idempotent)
- 10 novih API ruta: start, initiative, next-turn, prev-turn, state, add-participant, remove-participant, end, legendary, visibility

**Bug Fixes (v2.0.13+):**
- **NPC Combat Selection Fix** — `bindNpcPopup()` stacking click handlers na svakom SSE refresh-u. Svaki poziv dodavao novi `marker.on('click', ...)` bez uklanjanja starog. Nakon N SSE update-a, klik na NPC slao N puta `handleCombatTokenClick`. Fix: `.off()` prethodni handler pre dodavanja novog (kao što `popupopen` već radi).
- **Add-to-Fight Initiative Loop Fix** — U `combatAddMode`, stacked handlers prikazivali `prompt()` u petlji. Svaki OK slao dupli `add-participant` request. Cancel duplicirao NPC N puta u combat listi. Fix: Postavi `combatSelectionMode = false` i `combatAddMode = false` ODMAH pre `prompt()` poziva — preostali handleri izlaze preko `if (!combatSelectionMode) return false` guarda.

**Nije implementirano (deferred):**
- Combat log (save history) — samo live tracker
- Lair Actions (samo Legendary Actions za sada)
- HP tracker za player tokene (samo NPC-ovi imaju HP u sistemu)

---

### 2. Encounter Builder sa CR Kalkulacijom --- DONE (v2.0.13)

**Status:** IMPLEMENTIRANO

**Implementirano:**
- Party Config — unesi broj igrača i individualne levele
- XP budget kalkulacija (Easy/Medium/Hard/Deadly po DMG p.82 pravilima)
- Encounter multiplier po broju monstra (1→×1, 2→×1.5, 3-6→×2, 7-10→×2.5, 11-14→×3, 15+→×4)
- Monster Browser — pretraga iz Vault-a sa CR, Type, Size filterima
- Dodaj/skloni monstre iz encountera — automatski preračunaj adjusted XP i difficulty
- Difficulty bar sa bojama (Trivial/Easy/Medium/Hard/Deadly)
- Quick Templates — Ambush (3-6 mid-CR), Boss Fight (1 high + 2 low), Horde (8-12 low-CR)
- Save/Load encounters u bazu (JSON API)
- "Add to Map" — batch kreira NPC tokene iz encounter monstra na izabranoj mapi
- Avatar auto-download iz dnd5eapi.co
- DB: `encounters` tabela (party_levels, monsters kao JSON kolone)
- Responsive layout (two-column desktop, single-column mobile)

**Nije implementirano (deferred):**
- Random encounter generator (auto-pick po environment/difficulty)

**Effort:** Srednji

---

### 3. Session Notes / Recap Sistem --- DONE (v2.0.13)

**Status:** IMPLEMENTIRANO

**Implementirano:**
- "Previously On..." banner na dashboard-u (DM + Player) sa poslednjim recap-om
- Quest Journal stranica (`/journal`) — timeline UI svih completed sesija sa mesecnim markerima
- DM Live Notes — privatne beleske tokom confirmed/completed sesija (auto-save 800ms)
- Player Notes — privatne beleske po sesiji za svakog igraca (auto-save 800ms)
- Attendance Tracking — DM oznacava ko je prisustvovao sesiji
- "Missed a Session?" view (`/journal/missed`) — filtrirani recaps za propustene sesije
- Session Gallery — upload slika po sesiji (multer, 5MB limit), lightbox viewer, delete
- /history redirect na /journal (backwards compat)
- Nav link: "Session History" -> "Quest Journal"
- DB: session_notes, session_images, session_attendance tabele + migracija

**Nije implementirano (deferred):**
- Key NPCs/Locations auto-link u recap tekstu (buduci feature)

---

### 4. Poboljšan Session Scheduling (Best-in-Class) --- PARCIJALNO

**Rationale:** Scheduling je #1 problem D&D zajednice (33% igrača citira kao glavni izazov). Quest Planner VEĆ ima voting sistem — ali može biti DEFINITIVNO najbolji.

**Uradjeno u v2.0.13:**
- **Attendance tracking** — DM oznacava ko je prisustvovao (deo Session Notes feature-a)
- **Recurring Sessions** — toggle pri kreiranju sesije, izbor dana i vremena (npr. "Every Tuesday at 19:00"), "Generate Next Session" i "Skip This Week" dugmad na session detail-u
- **Quorum podrška** — minimum igrača (npr. 3/6), prikazuje se na slot grid-u (zeleno "Quorum met" / crveno "Need N more")
- **Attendance statistika** — Analytics stranica sa progress bar-ovima po igraču (iz session_attendance tabele)
- DB: `recurrence_rule`, `parent_session_id`, `min_players` kolone na sessions tabeli

**Uradjeno u P1 batch-u:**
- **Automatski reminders** — node-cron scheduler (svakih 15min), 24h i 1h pre confirmed sesije šalje Discord + push notifikacije. Idempotent flagovi (`reminder_24h_sent`, `reminder_1h_sent`) sprečavaju duplikate. Takođe se pokreće 5s posle startup-a da uhvati propuštene remindere.

**Preostalo:**
- **Quick RSVP** — prebačeno u sekciju 8a (Discord integracije), jer se RSVP link šalje putem Discord/push notifikacija
- **Waitlist** — ako je sesija puna, igrači se mogu staviti na waitlist (auto-notify kad se mesto oslobodi)
- ~~**Session Zero Checklist**~~ — UKLONJEN iz plana (niska korisnost, većina DM-ova koristi Google Docs/Discord za ovo)

**Zašto baš ovo:** When2Meet i Doodle nisu za D&D. Tabletop Time je jedini RPG scheduler ali nema ništa drugo. Quest Planner je jedini koji kombinuje scheduling + ceo campaign management. Recurring sessions i quorum bi bili game-changer.

**Effort:** Niski do srednji

---

## TIER 2: Visoka Vrednost (Pokreću Retenciju)

### 5. Random Tables & Generators (DM Quick Tools) --- DONE (P1 batch)

**Status:** IMPLEMENTIRANO

**Implementirano:**
- **NPC Generator** — ime po rasi i polu (10 rasa, 20+ imena po kombinaciji), profesija (40+), 2 personality traits (30+), motivacija (20+), secret/hook (20+). Copy + Save as NPC dugmad.
- **Loot Table** — po tieru (CR 0-4, 5-10, 11-16, 17+) i tipu (Individual/Hoard) prema DMG tabelama. Dice roller parser za notacije kao "3d6×100". "Add to Party Loot" dugme.
- **Name Generator** — fantasy imena po rasi i polu (10 rasa). Generiše 10 imena, click-to-copy.
- **Quick Reference Cards** — svih 15 D&D 5e conditions sa opisima, Combat Actions, Cover Rules, Ability Check DCs, Size Categories, Light Levels. Expandable `<details>` sekcije.
- **Tabbed UI** — reuse `.vault-tabs` stila, 4 taba
- Sav kod je client-side (`public/js/generators.js`), nema API poziva za generisanje
- DM-only pristup
- DB: Save NPC → `npc_tokens` tabela (source_type='generator'), Add Loot → `loot_items` tabela

**Nije implementirano (deferred):**
- Random Encounter Generator (biraj environment → encounter) — koristiti Encounter Builder umesto toga
- Random Tavern/Shop/Dungeon Room descriptions

**Effort:** Niski

---

### 6. Campaign Timeline / History View --- DONE (P1 batch)

**Status:** IMPLEMENTIRANO

**Implementirano:**
- **Story Arcs** — DM kreira arc-ove (ime, opis, boja) i dodeljuje sesije arc-ovima
- **Arc Dividers** u Quest Journal — obojeni banneri razdvajaju sesije po arc-u
- **Arc Badges** na svakoj session entry
- **Filter bar** — filtriranje po arc-u, igraču, lokaciji (GET parametri na `/journal`)
- **Manage Story Arcs** — collapsible DM sekcija za create/edit/delete arc-ova sa color picker-om
- **Inline Arc Assignment** — dropdown na svakoj sesiji u journal-u (auto-submit)
- **Arc Assignment na Session Detail** — DM može dodeliti arc na completed session detail stranici
- DB: `campaign_arcs` tabela (id, name, description, sort_order, color, created_by), `sessions.arc_id` kolona

**Nije implementirano (deferred):**
- World Calendar — custom in-game datumi (npr. "15th of Mirtul, 1492 DR")

**Effort:** Srednji

---

### 7. Prošireni Loot System (Party Inventory) --- DONE (P1 batch)

**Status:** IMPLEMENTIRANO

**Implementirano:**
- **Currency Dashboard** — Party Treasury (PP/GP/SP/CP) + Personal Wallet per player. DM edituje party, igrači edituju svoje.
- **Party Gold Split** — konvertuj sve u CP, podeli na N igrača, ostatak ostaje u treasury
- **Currency Log** — audit trail svih transakcija (poslednje 20 prikazano)
- **DM Staging Area** — hidden items (zlatni dashed border, eye-off ikona), "Reveal" dugme → SSE broadcast svim igračima
- **Attunement Tracking** — toggle attunement (max 3 per character), auto-break na transfer drugom igraču
- **Vault Autocomplete** — debounced pretraga (300ms) na `/loot/api/vault-items`, auto-fill rarity
- **Vault Stat Block** — popup sa detaljima itema iz 5e.tools vault-a (`/loot/api/vault-item-details`)
- **Rarity System** — Common/Uncommon/Rare/Very Rare/Legendary/Artifact sa bojama
- **Trade/Give** — igrači mogu davati vlastite iteme drugim igračima (DM može sve)
- **Quest Items** — kartice sa rarity badge, attunement badge, vault popup, "Give to..." dropdown
- DB: `party_currency` (single-row), `character_currency` (per-user), `currency_log` (audit), nove kolone na `loot_items` (hidden, attuned_to, vault_item_name, rarity)

**Nije implementirano (deferred):**
- Weight/Encumbrance tracking — opciona kalkulacija težine
- Session Loot History — filtriranje šta je nađeno u kojoj sesiji

**Effort:** Niski

---

### 8. Proširene Discord Integracije --- PARCIJALNO (P1 batch)

**Status:** PARCIJALNO IMPLEMENTIRANO

**Implementirano u P1 batch-u:**
- **Rich Embeds** — session_created (slot datumi, kategorija emoji, broj igrača), session_confirmed (lista igrača, ime mape), session_reminder (alarm emoji, narandžasta boja #e67e22). Svi embedi sa `.setThumbnail()` (app ikona).
- **Session Reminder Bot** — node-cron scheduler (svakih 15min), 24h i 1h pre confirmed sesije šalje Discord webhook + push notifikacije. Idempotent flagovi, pokreće se 5s posle startup-a.

**Preostalo (detaljni planovi ispod):**
- Quick RSVP (tokenized links, bez logina)
- Dice Roll Feed u Discord kanal (webhook, lako)
- Discord Bot Addon (slash commands, emoji RSVP — community addon)

**Zašto:** Discord je "living room" D&D zajednice. Roll20 ima Discord Activity integraciju. Foundry ima Discord module. Naš Discord webhook već radi — ali pravi Bot bi bio game-changer.

**Effort:** Nizak (Quick RSVP, Dice Feed) / Visok (Discord Bot Addon)

#### 8a. Quick RSVP — Glasanje bez Logina

**Status:** TODO

**Kako radi:**
- DM kreira sesiju → Quest Planner generiše **personalizovani token link** za svakog igrača
- Token je vezan za konkretnog korisnika (npr. `questplanner.com/rsvp/x7k9m2` = Markov token)
- Igrač klikne link → vidi slot grid → klikne "Available" → gotovo, **bez logina**
- Quest Planner evidentira glas jer token identifikuje korisnika

**Flow:**
1. DM kreira sesiju sa 3 datuma
2. Player "Marko" dobije Discord poruku: *"Nova sesija! Glasaj ovde: questplanner.com/rsvp/x7k9m2"*
3. Marko klikne → vidi slotove → klikne "Available" na suboti
4. Quest Planner upisuje glas kao Marko (token `x7k9m2` → user_id 5)

**Implementacija:**
- DB: `rsvp_tokens` tabela (token, user_id, session_id, expires_at, used_at)
- Route: `GET /rsvp/:token` — public (no auth), renderuje mini vote stranicu
- Route: `POST /rsvp/:token/vote` — upisuje glas, označava token kao korišćen
- Token generisanje: `crypto.randomBytes(16).toString('hex')` — 32-char unique
- Token expiry: 7 dana od kreiranja sesije
- Integracija: u Discord webhook embeds dodati personalizovani RSVP link za svakog igrača
- Ne zahteva Discord Bot — koristi postojeće webhook-ove + per-user DM ili channel message sa mention-om

**Effort:** Nizak — 1 nova ruta, 1 tabela, mali EJS template

#### 8b. Dice Roll Feed u Discord

**Status:** TODO

**Kako radi:**
- Kad neko baci kockice u Quest Planner-u (mapa ili dice roller stranica), rezultat se automatski pošalje u Discord kanal putem webhook-a

**Primer Discord poruke:**
```
🎲 Marko rolled 18 (d20 + 3) — Attack Roll
🎲 Ana rolled 24 (4d6) — Fireball Damage
🎲 DM rolled 12 (d20 + 5) — Goblin Saving Throw
```

**Implementacija:**
- Reuse postojećeg Discord webhook sistema (`helpers/discord.js`)
- Hook na `POST /dice/roll` endpoint — posle DB save, pošalji webhook
- DM toggle u Guild Settings: "Send dice rolls to Discord" (default: off)
- Opciono: filter po tipu (samo combat rolls, ili sve)
- Embed format: compact inline, bez thumbnail-a (da ne spamuje kanal)

**Effort:** Nizak — dodaj webhook poziv u postojeći dice endpoint

#### 8c. Discord Bot Addon — COMMUNITY ADDON (Browse Store)

**Status:** TODO — Potencijalno NAJJAČI addon za Quest Planner

**Zašto addon a ne core:** Discord Bot zahteva Bot Token, OAuth2 setup, i Discord Developer Portal konfiguraciju. Nije svaki korisnik spreman za to — zato je bolje kao opcionalni addon koji se instalira iz Browse Store-a.

**Šta addon uključuje:**

**1. Slash Commands:**

| Komanda | Opis | Primer odgovora |
|---------|------|-----------------|
| `/quest next` | Sledeća zakazana sesija | "📅 **Dragon's Lair** — Sub 15. mart u 19:00 (4/6 igrača confirmed)" |
| `/quest roll <dice>` | Baci kockice | "🎲 Marko rolled **18** (d20+3)" |
| `/quest roll <dice> <label>` | Baci sa opisom | "🎲 Marko rolled **18** (d20+3) — Attack Roll" |
| `/quest loot add <item>` | Dodaj item u party loot | "💰 Added **Sword of Flames** to party loot" |
| `/quest loot list` | Party inventory | Embed sa listom item-a po rarityju |
| `/quest party` | Lista igrača | Embed sa character imenima, klasama, levelima |
| `/quest recap` | Poslednji session recap | Embed sa "Previously On..." tekstom |
| `/quest status` | Kampanja overview | "⚔️ 23 sesija, 5 active quest-ova, 12,450 GP u treasury" |
| `/quest npc <name>` | NPC info | Stat block embed (HP, AC, abilities) |
| `/quest vote` | Quick vote link | Pošalje RSVP link za sledeću sesiju |

**2. Emoji RSVP (Glasanje iz Discorda):**

Kada Quest Planner pošalje session notifikaciju u Discord:
```
📅 Nova sesija: "Dragon's Lair Assault"

1️⃣ Subota 15. mart, 19:00
2️⃣ Nedelja 16. mart, 18:00
3️⃣ Utorak 18. mart, 20:00

Reaguj brojem za datume kad si dostupan!
```

- Igrači reaguju sa 1️⃣ 2️⃣ 3️⃣ emoji-jem
- Bot čita `messageReactionAdd` evente i upisuje glasove u Quest Planner bazu
- Zahteva **Discord-to-QP account linking** (player radi `/quest link <username>` jednom)

**3. Live Notifications u Discord:**
- Session confirmed → "@everyone Sesija potvrđena za subotu!"
- Quest revealed → "📜 Novi quest: Dragon's Hoard"
- Loot revealed → "💎 DM otkrio: Vorpal Sword (Legendary)"
- Combat started → "⚔️ Combat started on Dragon's Lair map!"

**4. Account Linking:**
- `/quest link <username>` — igrač povezuje Discord account sa QP accountom
- Verifikacija: QP šalje jedinstven kod koji igrač unese u Discord-u
- Jednom linkovano, bot zna ko je ko za emoji RSVP i personalizovane odgovore

**Tehnički zahtevi:**
- **Discord Bot Token** — korisnik kreira bota na Discord Developer Portal
- **discord.js** library (v14+) — Node.js Discord SDK
- **Bot Gateway Intents:** `GUILD_MESSAGES`, `GUILD_MESSAGE_REACTIONS`, `MESSAGE_CONTENT`
- **Slash Command Registration** — addon registruje komande pri instalaciji
- **Addon Settings UI** — polje za Bot Token, Guild ID, kanal za notifikacije
- **Addon Routes:**
  - `GET /discord-bot/settings` — konfiguracija (Bot Token, Guild ID, kanali)
  - `POST /discord-bot/link` — account linking API
  - `GET /discord-bot/status` — bot connection status (online/offline/error)
- **Bot Process:** child_process ili worker thread — pokreće se kao pozadinski proces kad je addon aktivan
- **Graceful Shutdown:** kad se addon disable-uje, bot se disconnectuje čisto

**Addon manifest:**
```json
{
  "id": "discord-bot",
  "name": "Discord Bot Integration",
  "version": "1.0.0",
  "author": "Quest Planner",
  "description": "Full Discord bot with slash commands, emoji RSVP, dice rolls, and live campaign notifications.",
  "category": "Integration",
  "icon": "message-circle",
  "adminOnly": false,
  "minAppVersion": "3.0.0",
  "dependencies": ["discord.js"],
  "settings": {
    "botToken": { "type": "password", "label": "Discord Bot Token", "required": true },
    "guildId": { "type": "text", "label": "Discord Server ID", "required": true },
    "notificationChannelId": { "type": "text", "label": "Notification Channel ID" },
    "diceChannelId": { "type": "text", "label": "Dice Roll Channel ID" },
    "enableSlashCommands": { "type": "boolean", "label": "Enable Slash Commands", "default": true },
    "enableEmojiRSVP": { "type": "boolean", "label": "Enable Emoji Voting", "default": true },
    "enableDiceFeed": { "type": "boolean", "label": "Send Dice Rolls to Discord", "default": false }
  }
}
```

**Zašto je ovo OPAK addon:**
- Nijedan self-hosted D&D tool nema ovako duboku Discord integraciju
- Roll20 ima Discord Activity (limited), Foundry ima basic webhook module
- Ovo bi bio **jedinstven selling point** za Quest Planner
- Community bi mogao da proširi bot sa custom komandama

**Effort:** Visok (2-3 dana razvoja), ali **ogroman impact**

---

## TIER 3: Diferentijatori (Pokreću Word-of-Mouth)

### 9. Quick Play / Guest Mode

**Rationale:** Owlbear Rodeo je popularan jer players ne trebaju accounts. Naš sistem zahteva registraciju za sve — to je friction.

**Šta bi radilo:**
- **Invite Links** — DM pošalje link, igrač klikne i vidi session schedule bez logina
- **Guest Vote** — glasaj za dostupnost bez registracije (samo uneseš ime)
- **View-Only Mode** — pogledaj mapu, timeline, loot bez accounta
- **Quick Join** — skraćeni registration (samo username + password, no email)

**Zašto:** #1 razlog zašto grupe ne usvoje novi alat: "Moji igrači neće da prave account." Smanjivanje friction-a dramatično povećava adoption.

**Effort:** Srednji

---

### 10. Ambijentalna Muzika / Sound Board --- DONE (v2.1.0)

**Status:** IMPLEMENTIRANO

**Implementirano:**
- **Sound Board Panel** — floating draggable panel (position saved u localStorage) sa launcher dugmadima za 4 sound sajta
- **Sound Sites** — Tabletopy, Tabletop Audio, Ambient Mixer, myNoise — otvaraju se u popup prozorima gde audio persistira dok navigirate Quest Planner
- **Custom URL** — unesi bilo koji URL i otvori u popup prozoru
- **Toolbar Buttons** — Sound dugme u map toolbar-u (top bar + fullscreen) i nav bar-u
- **localStorage Persistence** — pozicija, open/close stanje se čuvaju po uređaju

**Nije implementirano (deferred):**
- Map-Linked Audio — auto-play sound kad se otvori mapa
- DM Volume Control — sinhronizovani volume za sve igrače (cross-origin popup ograničenje)

**Effort:** Nizak

---

### 11. Map Drawing Tools (Grid Overlay) --- PARCIJALNO DONE (v2.1.0)

**Status:** PARCIJALNO IMPLEMENTIRANO (Grid Overlay done)

**Implementirano:**
- **Grid Overlay** — Square i Hex grid opcije sa DM toolbar panelom
- **Grid Controls** — Size (10-500px), Offset X/Y (-100 do 100), Opacity (0.05-1.0), Color picker
- **Per-Map Save** — grid settings se čuvaju u DB po mapi, vidljivi svim igračima
- **Canvas Rendering** — direktno canvas crtanje (ne Leaflet tiles) za pouzdan prikaz na svim zoom nivoima
- **SSE Sync** — grid update se broadcastuje svim igračima
- **Toolbar Buttons** — Grid dugme u map toolbar-u (top bar + fullscreen bar)
- DB: 7 novih kolona na `maps` tabeli (grid_enabled, grid_size, grid_offset_x/y, grid_color, grid_opacity, grid_type)

**Nije implementirano (deferred):**
- Drawing Tools — freehand, rectangle, circle, line
- Stamp Library — drag-drop ikone (vrata, sanduk, zamka, stena, drvo)
- Text Labels — dodaj nazive na mapi
- Layers — DM-only annotations

**Effort:** Srednji (za Grid), Visoki (za ostale drawing tools)

---

### 12. Handouts & Image Sharing --- DONE (v2.0.13 + P1 batch)

**Status:** IMPLEMENTIRANO

**Uradjeno u v2.0.13:**
- **Image Gallery** — po-sesijana galerija slika (Session Gallery)
- **DM Secret Notes** — privatne DM beleske po sesiji (DM Live Notes)

**Uradjeno u P1 batch-u:**
- **Handout Library** — DM upload slika (jpg/png/gif/webp/pdf, 10MB limit) i tekstualnih handout-a na `/handouts`
- **Real-Time Reveal** — DM klikne "Reveal" → SSE broadcast `handout-reveal` → toast notifikacija svim igračima ("DM shared: {title}")
- **Hide/Reveal Toggle** — DM može sakriti/otkriti handout-e (igrači vide samo revealed)
- **Linked to NPCs/Locations** — dropdown za linkovanje na NPC ili map lokaciju
- **Lightbox** — fullscreen overlay za slike, click-outside/ESC za zatvaranje
- **Handout Grid** — responsive grid (auto-fill minmax 200px), thumbnails sa hover zoom
- **Text Handouts** — expanded view za tekstualne handout-e
- DB: `handouts` tabela (title, type, content, image_path, linked_npc_id, linked_location_id, revealed)

**Effort:** Niski

---

### Map Enhancements: Chests, Autocomplete & Stat Block Popups --- DONE (v2.0.13+)

**Status:** IMPLEMENTIRANO

**Implementirano:**
- **Medieval Chest SVG** — zamena 🧰 emoji-ja sa detaljnim fantasy SVG ikonom (tamni hrast, zlatne trake sa zakovicama, ornamentalna bravica sa ključanicom, zakrivljeni poklopac sa wood grain). Reusable `chestSvg` varijabla.
- **Chest SVG u toolbar-u** — oba toolbar dugmeta (top bar + fullscreen bar) koriste novi chest SVG umesto emoji-ja. CSS `background-image` sa inline SVG data URI.
- **Item Autocomplete u Chest Editor-u** — debounced (300ms, min 2 chars) pretraga `/loot/api/vault-items?q=...` prilikom kucanja naziva itema. Dropdown sa imenom + rarity badge. Klik popunjava input. Event delegation na `document` za dinamički kreirane inpute.
- **Item Detail Popup iz Chest-a** — klik na ime itema u chest popup-u otvara vault-style stat block modal (kategorija, rarity, cost, weight, attunement, opis, weapon/armor stats, source). Koristi `showMapDetailModal()` overlay.
- **NPC Creature Stat Block Link** — klik na ime bestiary NPC-a u popup-u otvara puni creature stat block (AC, HP, Speed, ability scores sa modifierima, saving throws, skills, damage resistances/immunities, condition immunities, senses, languages, CR/XP, traits, actions, bonus actions, reactions, legendary actions, source). Custom NPC-ovi (bez `source_key`) nemaju link.
- **Reusable Map Detail Modal** — `showMapDetailModal(title, html)` fullscreen overlay sa close dugmetom, click-outside i ESC za zatvaranje. Koristi postojeće `.dnd-card` CSS klase.
- **source_key u SQL upitima** — dodat `n.source_key` u oba NPC token SELECT upita (`routes/map.js`: render + SSE token-state refresh)
- Fajlovi: `views/map.ejs`, `routes/map.js`, `public/css/style.css`
- Nema novih backend endpoint-a — svi API-ji već postoje (`/loot/api/vault-items`, `/loot/api/vault-item-details`, `/vault/monsters/:key`)

**Effort:** Niski

---

## TIER 4: Budući / Nice-to-Have

### 13. World Calendar System
Custom kalendar za game world (npr. Forgotten Realms kalendar sa mesecima kao Hammer, Alturiak...). Pratite in-game dane, sezone, praznike.

### 14. Multi-Campaign Support
DM može voditi više kampanja u istoj instanci. Svaka kampanja ima svoje sesije, mape, NPC-ove, loot.

### 15. Bestiary Bookmarks / Custom Monster Builder
Pored Open5e importa, DM može kreirati custom monstre sa stat block editor-om.

### 16. Player Journal / In-Character Diary
Igrači pišu in-character dnevnik između sesija. Podstiče angažman između sesija.

### 17. Quest Board / Hook Tracker --- DONE (v2.1.0)

**Status:** IMPLEMENTIRANO

**Implementirano:**
- **Quest Board stranica** (`/quests`) — tavern bulletin board sa parchment-style karticama
- **Quest CRUD** — DM kreira/edituje/briše questove sa title, description, difficulty, reward, quest giver, linked map, story arc, objectives
- **Objectives Checklist** — DM toggleuje checkboxove, auto-save via fetch
- **Status System** — Available → Active → Completed / Failed sa color-coded badge-ovima
- **Difficulty Badges** — Trivial/Easy/Medium/Hard/Deadly
- **DM Staging** — hidden/revealed questovi sa SSE broadcast "New quest posted" toast
- **Quest Map Pins** — 📜 markeri na mapi za linkovane questove sa popup detaljima
- **Active Quests Widget** — na DM i Player dashboard-u (top 3 active/available questova)
- **Nav Link** — "Quest Board" u Tools grupi
- DB: `quests` + `quest_objectives` tabele, `routes/quests.js`, `views/quests.ejs`, `views/partials/quest-card.ejs`

### 18. Map Sharing / Export
Export mape kao PNG/PDF za štampanje ili deljenje na social media.

---

## Prioritetna Matrica

| # | Feature | Impact | Effort | Prioritet | Status |
|---|---------|--------|--------|-----------|--------|
| 1 | Initiative & Combat Tracker | Visok | Srednji | **P0** | ✅ DONE (v2.0.13) |
| 2 | Encounter Builder | Visok | Srednji | **P0** | ✅ DONE (v2.0.13) |
| 3 | Session Notes / Recap | Visok | Nizak | **P0** | ✅ DONE (v2.0.13) |
| 4 | Scheduling Poboljšanja | Visok | Nizak | **P0** | 🔶 PARCIJALNO (recurring, quorum, stats, reminders done) |
| 5 | Random Generators | Srednji | Nizak | **P1** | ✅ DONE (P1 batch) |
| 6 | Campaign Timeline | Srednji | Srednji | **P1** | ✅ DONE (P1 batch) |
| 7 | Prošireni Loot | Srednji | Nizak | **P1** | ✅ DONE (P1 batch) |
| 8a | Quick RSVP (tokenized links) | Visok | Nizak | **P1** | ⬜ TODO |
| 8b | Dice Roll Feed (webhook) | Srednji | Nizak | **P1** | ⬜ TODO |
| 8c | Discord Bot Addon (slash cmds, emoji RSVP) | Vrlo Visok | Visok | **P1** | ⬜ TODO — COMMUNITY ADDON |
| 9 | Guest Mode | Visok | Srednji | **P1** | ⏸️ ON HOLD |
| 10 | Ambient Sound | Srednji | Visok | **P2** | ✅ DONE (v2.1.0) |
| 11 | Map Drawing Tools (Grid Overlay) | Srednji | Visok | **P2** | ✅ DONE (v2.1.0) |
| 12 | Handouts & Image Share | Srednji | Nizak | **P1** | ✅ DONE (v2.0.13 + P1 batch) |
| 13 | World Calendar | Nizak | Srednji | **P3** | ⬜ TODO |
| 14 | Multi-Campaign | Srednji | Visok | **P3** | ⬜ TODO |
| 15 | Custom Monster Builder | Nizak | Srednji | **P3** | ⬜ TODO |
| 16 | Player Journal | Nizak | Nizak | **P3** | ⬜ TODO |
| 17 | Quest Board | Srednji | Srednji | **P2** | ✅ DONE (v2.1.0) |
| 18 | Map Export | Nizak | Nizak | **P3** | ⬜ TODO |
| 19 | Map Enhancements (Chests, Autocomplete, Stat Blocks) | Srednji | Nizak | **P1** | ✅ DONE (v2.0.13+) |

---

## Preporuka: Šta Prvo Raditi

**Quick Wins (mali effort, visok impact):**
1. Session Notes / Recap proširenje (nadograđuje se na postojeći sistem)
2. Scheduling poboljšanja (recurring, quorum, reminders)
3. Prošireni Loot system (currency tracker, staging)
4. Handouts & Image Sharing

**Big Bets (srednji effort, visok impact):**
5. Initiative & Combat Tracker na mapama
6. Encounter Builder sa CR kalkulacijom
7. Guest Mode / Invite Links

Ova kombinacija bi Quest Planner učinila **jedinim alatom koji D&D grupa treba** — scheduling + session notes + maps + combat + loot + community u jednom self-hosted paketu. Nijedan drugi alat na tržištu to ne nudi.

---

## Izvori Istraživanja

- [Roll20](https://roll20.net/) — 12M korisnika, browser VTT, $0-$150/god
- [D&D Beyond](https://www.dndbeyond.com/) — Official digital toolset, character builder, Maps VTT
- [Foundry VTT](https://foundryvtt.com/) — Self-hosted, $50 one-time, 350+ game systems
- [Owlbear Rodeo](https://www.owlbear.rodeo/) — Lightweight VTT, <1 min setup
- [5e.tools](https://5e.tools/) — Free community D&D 5e reference
- [Kobold+ Fight Club](https://koboldplus.club/) — Encounter builder sa CR kalkulacijom
- [Improved Initiative](https://improvedinitiative.app/) — Standalone combat tracker
- [Sly Flourish](https://slyflourish.com/) — Lazy DM framework, DM prep methodology
- [World Anvil](https://www.worldanvil.com/) — Campaign wiki, $0-$7/mo
- [LegendKeeper](https://www.legendkeeper.com/) — Campaign wiki, $9/mo
- [Kanka](https://kanka.io/) — Campaign manager, free tier
- [Tabletop Time](https://www.tabletoptime.us/) — RPG session scheduler
- [Dungeon Alchemist](https://www.dungeonalchemist.com/) — AI map maker, $45 one-time
- [Inkarnate](https://inkarnate.com/) — World/battle map maker
- [AboveVTT](https://chromewebstore.google.com/detail/abovevtt/) — Free D&D Beyond overlay VTT
- Reddit: r/dnd, r/DMAcademy, r/dndnext, r/FoundryVTT
- [EN World](https://www.enworld.org/) — TTRPG community forums
- [D&D Beyond 2026 Roadmap](https://www.dndbeyond.com/posts/2132-d-d-beyonds-2026-development-roadmap)
