# Quest Planner — D&D Session Scheduler

Web aplikacija gde Dungeon Master kreira termine za sesije, a igraci glasaju koji im odgovaraju.
Dark fantasy tema, Node.js + SQLite backend, EJS server-side rendering.

## Sadrzaj

- [Preduslovi](#preduslovi)
- [Instalacija na web serveru](#instalacija-na-web-serveru)
  - [1. Kloniranje repozitorijuma](#1-kloniranje-repozitorijuma)
  - [2. Instalacija zavisnosti](#2-instalacija-zavisnosti)
  - [3. Konfiguracija](#3-konfiguracija)
  - [4. Pokretanje](#4-pokretanje)
  - [5. Process manager (produkcija)](#5-process-manager-produkcija)
  - [6. Reverse proxy (Nginx)](#6-reverse-proxy-nginx)
- [Instalacija putem Dockera](#instalacija-putem-dockera)
  - [1. Docker build i run](#1-docker-build-i-run)
  - [2. Docker Compose](#2-docker-compose)
  - [3. Docker na Raspberry Pi](#3-docker-na-raspberry-pi)
- [Koriscenje aplikacije](#koriscenje-aplikacije)
- [Struktura projekta](#struktura-projekta)
- [Backup baze](#backup-baze)

---

## Preduslovi

### Za instalaciju na serveru (bez Dockera)

- **Node.js** >= 18.x
- **npm** >= 9.x
- **Git**

Na Raspberry Pi (Debian/Ubuntu):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs git
```

### Za Docker instalaciju

- **Docker** >= 20.x
- **Docker Compose** >= 2.x (opciono, ali preporuceno)

Na Raspberry Pi:

```bash
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker $USER
# Logout/login da bi grupa postala aktivna
```

---

## Instalacija na web serveru

### 1. Kloniranje repozitorijuma

```bash
cd /opt
git clone https://github.com/YOUR_USERNAME/dndplanning.git
cd dndplanning
```

Ili ako kopiras fajlove rucno, prebaci ih u zeljeni direktorijum (npr. `/opt/dndplanning`).

### 2. Instalacija zavisnosti

```bash
npm install --production
```

Flag `--production` preskace dev zavisnosti (nodemon) jer u produkciji nisu potrebne.

### 3. Konfiguracija

Kreiraj `.env` fajl na osnovu primera:

```bash
cp .env.example .env
```

Otvori `.env` i podesi vrednosti:

```env
PORT=3000
SESSION_SECRET=ovde-stavi-dugi-random-string
```

Za generisanje sigurnog session secret-a:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Kopiraj izlaz i postavi ga kao `SESSION_SECRET`.

### 4. Pokretanje

**Development** (sa auto-reload-om):

```bash
npm run dev
```

**Produkcija**:

```bash
npm start
```

Aplikacija ce biti dostupna na `http://localhost:3000` (ili koji port si podesio u `.env`).

### 5. Process manager (produkcija)

Za produkcijsko okruzenje koristi **PM2** da bi aplikacija radila kao servis i automatski se restartovala:

```bash
# Instalacija PM2
sudo npm install -g pm2

# Pokretanje aplikacije
cd /opt/dndplanning
pm2 start server.js --name quest-planner

# Automatsko pokretanje pri boot-u
pm2 startup
pm2 save
```

Korisne PM2 komande:

```bash
pm2 status              # Status svih procesa
pm2 logs quest-planner  # Logovi u realnom vremenu
pm2 restart quest-planner
pm2 stop quest-planner
```

### 6. Reverse proxy (Nginx)

Ako zelis da aplikacija bude dostupna na portu 80/443 (sa ili bez domena), postavi Nginx kao reverse proxy.

Instaliraj Nginx:

```bash
sudo apt install -y nginx
```

Kreiraj konfiguraciju `/etc/nginx/sites-available/quest-planner`:

```nginx
server {
    listen 80;
    server_name quest.example.com;  # ili tvoja IP adresa

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Aktiviraj sajt i restartuj Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/quest-planner /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

Za HTTPS sa Let's Encrypt:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d quest.example.com
```

---

## Instalacija putem Dockera

### 1. Docker build i run

Iz root direktorijuma projekta:

```bash
# Build image
docker build -t quest-planner .

# Pokreni kontejner
docker run -d \
  --name quest-planner \
  -p 3000:3000 \
  -e SESSION_SECRET=$(openssl rand -hex 48) \
  -v quest-planner-data:/app/data \
  --restart unless-stopped \
  quest-planner
```

Objasnjenje parametara:

| Parametar | Opis |
|---|---|
| `-d` | Pokrece kontejner u pozadini (detached) |
| `--name quest-planner` | Ime kontejnera za lakse upravljanje |
| `-p 3000:3000` | Mapira port 3000 sa hosta na kontejner |
| `-e SESSION_SECRET=...` | Postavlja session secret kao env varijablu |
| `-v quest-planner-data:/app/data` | Perzistentni volume za SQLite bazu podataka |
| `--restart unless-stopped` | Auto-restart pri boot-u i crash-u |

Korisne Docker komande:

```bash
docker logs quest-planner          # Logovi
docker logs -f quest-planner       # Logovi u realnom vremenu
docker stop quest-planner          # Zaustavi
docker start quest-planner         # Pokreni ponovo
docker restart quest-planner       # Restart
docker rm -f quest-planner         # Obrisi kontejner (podaci ostaju u volume-u)
```

### 2. Docker Compose

Jednostavniji nacin za upravljanje kontejnerom. Koristi `docker-compose.yml` koji je vec ukljucen u projekat:

```bash
# Pokreni (build + start)
docker compose up -d

# Logovi
docker compose logs -f

# Zaustavi
docker compose down

# Rebuild posle izmena koda
docker compose up -d --build
```

`docker-compose.yml` automatski:
- Build-uje image iz Dockerfile-a
- Mapira port 3000
- Kreira perzistentni volume za bazu
- Postavlja restart politiku
- Ucitava env varijable iz `.env` fajla

### 3. Docker na Raspberry Pi

Docker image radi na ARM64 arhitekturi (Raspberry Pi 4/5) bez ikakvih izmena jer koristi Node.js Alpine image koji podrzava vise arhitektura.

```bash
# Na Raspberry Pi-u
cd /opt/dndplanning
docker compose up -d
```

Ako se na Pi-u koristi stariji 32-bit OS, zameni base image u `Dockerfile`:

```dockerfile
FROM node:20-bullseye-slim
```

umesto `node:20-alpine`.

#### Pristup iz lokalne mreze

Ako je Pi na adresi `192.168.1.100`, aplikacija je dostupna na:

```
http://192.168.1.100:3000
```

Za pristup sa prilagodnim domenom, dodaj u `/etc/hosts` na klijent masini:

```
192.168.1.100  quest.local
```

---

## Koriscenje aplikacije

### Prvog korisnika

1. Otvori `http://localhost:3000` (ili adresu servera)
2. Klikni **"Join the Guild"** da se registrujes
3. **Prvi registrovani korisnik automatski postaje Dungeon Master**
4. Svi naredni korisnici postaju Playeri (Adventureri)

### DM workflow

1. Na dashboard-u klikni **"Post to Tavern Board"**
2. Unesi naziv sesije, opis i predlozene termine
3. Klikni **"Post to Tavern Board"** da objavis
4. Pregledaj glasove igraca u tabeli dostupnosti
5. Izaberi termin i klikni **"Proclaim This Date"** da potvrdis

### Player workflow

1. Na dashboard-u vidis sve objavljene sesije
2. Klikni na sesiju koja ima badge **"Needs your vote"**
3. Za svaki termin izaberi: **Available** / **Maybe** / **Unavailable**
4. Klikni **"Submit Availability"**

---

## Struktura projekta

```
dndplanning/
├── server.js              # Express entry point
├── package.json
├── .env                   # Env varijable (nije u git-u)
├── .env.example           # Primer env fajla
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── db/
│   ├── schema.sql         # DDL za SQLite tabele
│   └── connection.js      # SQLite konekcija i inicijalizacija
├── middleware/
│   ├── auth.js            # Auth middleware (login, DM check)
│   └── flash.js           # Flash poruke
├── routes/
│   ├── auth.js            # Register, login, logout
│   ├── dashboard.js       # Redirect po roli (DM/Player)
│   ├── sessions.js        # CRUD sesija, potvrda termina
│   └── votes.js           # Glasanje igraca
├── views/                 # EJS templejti
│   ├── partials/          # Header, footer, nav, flash, grid
│   ├── auth/              # Login, register stranice
│   ├── dm/                # DM dashboard, forma, detalj sesije
│   └── player/            # Player dashboard, glasanje
├── public/
│   ├── css/style.css      # Dark fantasy tema
│   └── js/app.js          # Slot picker, flash dismiss
└── data/                  # SQLite fajlovi (nije u git-u)
```

---

## Backup baze

SQLite baza se nalazi u `data/` direktorijumu (ili u Docker volume-u).

### Na serveru (bez Dockera)

```bash
# Rucni backup
cp /opt/dndplanning/data/dndplanning.db /backup/dndplanning-$(date +%Y%m%d).db

# Cron job za dnevni backup (dodaj u crontab -e)
0 3 * * * cp /opt/dndplanning/data/dndplanning.db /backup/dndplanning-$(date +\%Y\%m\%d).db
```

### Sa Docker volume-a

```bash
# Pronalazenje volume putanje
docker volume inspect quest-planner-data

# Kopiranje baze iz kontejnera
docker cp quest-planner:/app/data/dndplanning.db ./backup-dndplanning.db
```
