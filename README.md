# Кабинет репетитора

## Локальный запуск

```bash
cp .env.example .env
npm install
npm start
```

Открыть `http://localhost:3000`.

При регистрации код из `TUTOR_INVITE_CODE` создаёт кабинет репетитора. Остальные пользователи регистрируются как ученики.

## Установка на Ubuntu без домена

Установить Docker:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
```

Скопировать проект на сервер (например через Git), затем:

```bash
cd tutor-booking
cp .env.example .env
nano .env
docker compose up -d --build
```

В `.env` обязательно заменить `JWT_SECRET` и `TUTOR_INVITE_CODE`. Сайт будет доступен по `http://IP_СЕРВЕРА:3000`.

Для доступа извне откройте порт 3000 в firewall:

```bash
sudo ufw allow 3000/tcp
```

Резервная копия данных:

```bash
cp data/db.json data/db.backup.json
```
