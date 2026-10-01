"""Windows local companion for direct ESC/POS printing and daily SQLite backup.

Commands:
    python local_agent.py configure
    python local_agent.py serve
    python local_agent.py backup
    python local_agent.py test-print
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from logging.handlers import RotatingFileHandler
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen


BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "local_agent_config.json"
LOG_PATH = BASE_DIR / "local_agent.log"


def setup_logging() -> None:
    handler = RotatingFileHandler(LOG_PATH, maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler, logging.StreamHandler()])


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        raise RuntimeError("local_agent_config.json topilmadi. Avval 'python local_agent.py configure' ni bajaring.")
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    required = ("site_url", "allowed_origin", "backup_folder", "backup_token")
    missing = [key for key in required if not str(config.get(key, "")).strip()]
    if missing:
        raise RuntimeError("Konfiguratsiyada yetishmaydi: " + ", ".join(missing))
    config.setdefault("printer_name", "")
    config.setdefault("agent_port", 17832)
    return config


def configure() -> None:
    previous = {}
    if CONFIG_PATH.exists():
        try:
            previous = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            previous = {}

    def ask(label: str, key: str, default: str = "") -> str:
        current = str(previous.get(key, default))
        suffix = f" [{current}]" if current else ""
        value = input(f"{label}{suffix}: ").strip()
        return value or current

    site_url = ask("Render sayt URL (https://...onrender.com)", "site_url").rstrip("/")
    parsed = urlparse(site_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError("Sayt URL noto'g'ri")
    default_origin = f"{parsed.scheme}://{parsed.netloc}"
    allowed_origin = ask("Brauzer origin", "allowed_origin", default_origin).rstrip("/")
    backup_folder = ask("Backup papka to'liq yo'li", "backup_folder", str(Path.home() / "Tarozi Backups"))
    backup_token = ask("Techadmin yaratgan backup token", "backup_token")
    printer_name = ask("Printer nomi (bo'sh bo'lsa Windows default printer)", "printer_name")
    port_text = ask("Lokal agent porti", "agent_port", "17832")
    port = int(port_text)
    if port < 1024 or port > 65535:
        raise RuntimeError("Port 1024-65535 oralig'ida bo'lishi kerak")

    config = {
        "site_url": site_url,
        "allowed_origin": allowed_origin,
        "backup_folder": str(Path(backup_folder).expanduser().resolve()),
        "backup_token": backup_token,
        "printer_name": printer_name,
        "agent_port": port,
    }
    Path(config["backup_folder"]).mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saqlandi: {CONFIG_PATH}")


def ascii_bytes(value: object) -> bytes:
    return str(value).encode("ascii", errors="replace")


def escpos_qr(data: bytes, module_size: int = 5) -> bytes:
    gs = b"\x1d"
    size = max(1, min(module_size, 16))
    length = len(data) + 3
    p_low = length % 256
    p_high = length // 256
    return b"".join(
        (
            gs + b"(k\x04\x00\x31\x41\x32\x00",
            gs + b"(k\x03\x00\x31\x43" + bytes([size]),
            gs + b"(k\x03\x00\x31\x45\x31",
            gs + b"(k" + bytes([p_low, p_high]) + b"\x31\x50\x30" + data,
            gs + b"(k\x03\x00\x31\x51\x30",
        )
    )


def build_receipt(receipt: dict) -> bytes:
    required = ("receipt_no", "plate_number", "price_fmt", "created_at")
    missing = [key for key in required if not str(receipt.get(key, "")).strip()]
    if missing:
        raise ValueError("Chek ma'lumoti yetarli emas: " + ", ".join(missing))

    esc = b"\x1b"
    gs = b"\x1d"
    width = 42

    def center(text: object) -> bytes:
        return ascii_bytes(text).center(width) + b"\n"

    def line(left: object, right: object) -> bytes:
        left_b = ascii_bytes(left)
        right_b = ascii_bytes(right)
        space = max(1, width - len(left_b) - len(right_b))
        return left_b + b" " * space + right_b + b"\n"

    qr_text = receipt.get("qr_text") or (
        f"AIRITOM LOGISTICS CENTER MCHJ\n"
        f"Chek: {receipt['receipt_no']}\n"
        f"Mashina: {receipt['plate_number']}\n"
        f"Sana: {receipt['created_at']}\n"
        f"Narx: {receipt['price_fmt']} so'm"
    )

    data = bytearray()
    data += esc + b"@"
    data += esc + b"a\x01"
    data += esc + b"E\x01" + esc + b"!\x10"
    data += center("AIRITOM LOGISTICS")
    data += center("CENTER MCHJ")
    data += esc + b"!\x00" + esc + b"E\x00"
    data += center("Avtomobil o'lchash cheki")
    data += center("=" * width)
    data += esc + b"a\x00"
    data += line("Chek:", receipt["receipt_no"])
    data += line("Sana:", receipt["created_at"])
    data += center("-" * width)
    data += esc + b"E\x01" + esc + b"!\x20"
    data += line("Mashina:", receipt["plate_number"])
    data += esc + b"!\x00"
    data += line("Narx:", f"{receipt['price_fmt']} so'm")
    method = {"cash": "Naqd pul", "card": "Uzcard/Humo", "bank": "Hisob raqam"}.get(
        receipt.get("payment_method"), "Naqd pul"
    )
    data += line("To'lov turi:", method)
    data += line("Holat:", "To'landi")
    data += esc + b"E\x00" + esc + b"a\x01"
    data += b"\n" + escpos_qr(ascii_bytes(qr_text), module_size=5) + b"\n"
    data += center("Rahmat!")
    data += b"\n\n\n\n"
    data += gs + b"V\x42\x00"
    return bytes(data)


def print_raw(receipt: dict, config: dict) -> str:
    try:
        import win32print
    except ImportError as exc:
        raise RuntimeError("pywin32 o'rnatilmagan: pip install pywin32") from exc

    printer_name = config.get("printer_name") or win32print.GetDefaultPrinter()
    if not printer_name:
        raise RuntimeError("Windows default printer topilmadi")
    payload = build_receipt(receipt)
    printer = None
    document_started = False
    page_started = False
    try:
        printer = win32print.OpenPrinter(printer_name)
        win32print.StartDocPrinter(printer, 1, ("Tarozi Chek", None, "RAW"))
        document_started = True
        win32print.StartPagePrinter(printer)
        page_started = True
        written = win32print.WritePrinter(printer, payload)
        if written != len(payload):
            raise RuntimeError(f"Printer {len(payload)} baytdan faqat {written} bayt qabul qildi")
        win32print.EndPagePrinter(printer)
        page_started = False
        win32print.EndDocPrinter(printer)
        document_started = False
        logging.info("Receipt %s sent to %s", receipt.get("receipt_no"), printer_name)
        return printer_name
    finally:
        if printer is not None:
            if page_started:
                try:
                    win32print.EndPagePrinter(printer)
                except Exception:
                    logging.exception("Could not end printer page")
            if document_started:
                try:
                    win32print.EndDocPrinter(printer)
                except Exception:
                    logging.exception("Could not end printer document")
            try:
                win32print.ClosePrinter(printer)
            except Exception:
                logging.exception("Could not close printer")


class AgentHandler(BaseHTTPRequestHandler):
    server_version = "TaroziLocalAgent/2"
    config: dict = {}

    def log_message(self, fmt: str, *args) -> None:
        logging.info("HTTP %s - %s", self.address_string(), fmt % args)

    def allowed_origin(self) -> str | None:
        origin = self.headers.get("Origin", "").rstrip("/")
        expected = str(self.config.get("allowed_origin", "")).rstrip("/")
        return origin if origin and hmac_compare(origin, expected) else None

    def send_json(self, status: int, payload: dict, origin: str | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        origin = self.allowed_origin()
        if not origin:
            self.send_json(403, {"success": False, "message": "Origin ruxsat etilmagan"})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_json(404, {"success": False, "message": "Topilmadi"})
            return
        origin = self.allowed_origin()
        try:
            import win32print
            printer_name = self.config.get("printer_name") or win32print.GetDefaultPrinter()
            handle = win32print.OpenPrinter(printer_name)
            win32print.ClosePrinter(handle)
            self.send_json(
                200,
                {"success": True, "service": "Tarozi Local Agent", "printer": printer_name, "printer_ready": True},
                origin,
            )
        except Exception as exc:
            self.send_json(
                503,
                {"success": False, "service": "Tarozi Local Agent", "printer_ready": False, "message": str(exc)},
                origin,
            )

    def do_POST(self) -> None:
        origin = self.allowed_origin()
        if not origin:
            self.send_json(403, {"success": False, "message": "Origin ruxsat etilmagan"})
            return
        if self.path not in {"/print", "/feed"}:
            self.send_json(404, {"success": False, "message": "Topilmadi"}, origin)
            return
        try:
            if self.path == "/feed":
                import win32print
                printer_name = self.config.get("printer_name") or win32print.GetDefaultPrinter()
                handle = win32print.OpenPrinter(printer_name)
                try:
                    win32print.StartDocPrinter(handle, 1, ("Tarozi Qog'oz Surish", None, "RAW"))
                    win32print.StartPagePrinter(handle)
                    win32print.WritePrinter(handle, b"\n\n\n\n\n")
                    win32print.EndPagePrinter(handle)
                    win32print.EndDocPrinter(handle)
                finally:
                    win32print.ClosePrinter(handle)
                self.send_json(200, {"success": True, "printer": printer_name}, origin)
                return
            length = int(self.headers.get("Content-Length", "0"))
            if length < 2 or length > 65536:
                raise ValueError("So'rov hajmi noto'g'ri")
            receipt = json.loads(self.rfile.read(length).decode("utf-8"))
            printer = print_raw(receipt, self.config)
            self.send_json(200, {"success": True, "printer": printer}, origin)
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json(400, {"success": False, "message": str(exc)}, origin)
        except Exception as exc:
            logging.exception("Print failed")
            self.send_json(500, {"success": False, "message": f"Printer xatosi: {exc}"}, origin)


def hmac_compare(left: str, right: str) -> bool:
    import hmac
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


def serve(config: dict) -> None:
    AgentHandler.config = config
    address = ("127.0.0.1", int(config.get("agent_port", 17832)))
    server = ThreadingHTTPServer(address, AgentHandler)
    logging.info("Local agent listening on http://%s:%s", *address)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def quick_check_sqlite(path: Path) -> None:
    with path.open("rb") as source:
        header = source.read(16)
    if header != b"SQLite format 3\x00":
        raise RuntimeError("Serverdan kelgan fayl SQLite emas")
    connection = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        result = connection.execute("PRAGMA quick_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError("SQLite quick_check muvaffaqiyatsiz")
    finally:
        connection.close()


def download_backup(config: dict) -> Path:
    folder = Path(config["backup_folder"]).expanduser().resolve()
    folder.mkdir(parents=True, exist_ok=True)
    url = config["site_url"].rstrip("/") + "/api/backups/sqlite"
    request = Request(
        url,
        headers={
            "Authorization": f"Bearer {config['backup_token']}",
            "User-Agent": "TaroziLocalAgent/2",
            "Accept": "application/vnd.sqlite3",
        },
    )
    fd, temp_name = tempfile.mkstemp(prefix=".tarozi-backup-", suffix=".part", dir=folder)
    os.close(fd)
    temp_path = Path(temp_name)
    try:
        with urlopen(request, timeout=180) as response, temp_path.open("wb") as target:
            if response.status != 200:
                raise RuntimeError(f"Backup server HTTP {response.status}")
            shutil.copyfileobj(response, target, length=1024 * 1024)
            target.flush()
            os.fsync(target.fileno())
        quick_check_sqlite(temp_path)
        filename = f"{datetime.now().strftime('%d.%m.%Y')} 00-00 holatiga backup.db"
        destination = folder / filename
        os.replace(temp_path, destination)
        for old_file in folder.glob("* 00-00 holatiga backup.db"):
            if old_file != destination:
                try:
                    old_file.unlink()
                except OSError:
                    logging.exception("Could not remove old backup %s", old_file)
        logging.info("Backup saved: %s", destination)
        return destination
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Tarozi Kiosk Windows local agent")
    parser.add_argument("command", choices=("configure", "serve", "backup", "test-print"))
    args = parser.parse_args()
    setup_logging()
    try:
        if args.command == "configure":
            configure()
            return 0
        config = load_config()
        if args.command == "serve":
            serve(config)
        elif args.command == "backup":
            destination = download_backup(config)
            print(f"Backup tayyor: {destination}")
        elif args.command == "test-print":
            sample = {
                "receipt_no": "TEST/00001",
                "plate_number": "01 A 123 BA",
                "price_fmt": "30 000",
                "created_at": datetime.now().strftime("%d.%m.%Y %H:%M:%S"),
            }
            printer = print_raw(sample, config)
            print(f"Test chek yuborildi: {printer}")
        return 0
    except Exception as exc:
        logging.exception("Agent command failed")
        print(f"XATO: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
