# Infrastructure and Operations

## Khởi động

```powershell
cd D:\upgrade-diagram-as-code\product\deploy
Copy-Item .env.example .env
# Sửa DIAGRAM_API_KEYS trong .env trước khi chạy.
docker compose up -d --build
$env:DIAGRAM_API_KEY = "key-trong-file-env"
npm --prefix .. run smoke
```

Kiểm tra `http://localhost:9000/health` cho tiến trình Gateway và `/ready` cho cả đường kết nối tới Kroki. Kroki và Mermaid không publish port ra host.

## TLS và mạng

Đặt Gateway sau reverse proxy có HTTPS khi dùng ngoài localhost. Chỉ cho runner, VPN hoặc mạng công ty truy cập. Không expose trực tiếp Kroki/Mermaid. Giữ `AUTH_MODE=required`; `disabled` chỉ dành cho local cô lập.

## Vận hành thường ngày

- Xem trạng thái: `docker compose ps`.
- Xem log: `docker compose logs -f --tail=200 gateway kroki mermaid`.
- Cập nhật image pin trong `.env`, chạy `docker compose pull` rồi `docker compose up -d --build`.
- Smoke test sau mỗi lần deploy bằng `npm --prefix .. run smoke`.
- Rollback bằng cách trả image tag cũ trong `.env` và chạy lại Compose.

Gateway MVP không có database hay volume dữ liệu. Cache nằm trong RAM và mất khi restart; source và SVG chuẩn vẫn nằm trong Git.

## Xoay API key

`DIAGRAM_API_KEYS` nhận danh sách phân tách bằng dấu phẩy. Thêm key mới, restart Gateway, cập nhật VS Code SecretStorage và GitHub secret, xác nhận client hoạt động, sau đó xóa key cũ và restart lần nữa.

## Giám sát tối thiểu

Theo dõi HTTP 5xx, thời gian render, memory/container restart và dung lượng log. Cảnh báo khi `/ready` lỗi liên tục trên 2 phút. LRU và single-flight chỉ có hiệu lực trong từng Gateway replica; MVP nên bắt đầu với một replica.
