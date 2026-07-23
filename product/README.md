# Diagram as Code Product

Lớp sản phẩm này bổ sung workflow hoàn chỉnh quanh fork Kroki mà không trộn code tùy biến vào module upstream:

- `gateway`: Fastify API có API key, validation, timeout, LRU và single-flight.
- `vscode-extension`: live preview và export SVG thủ công, ổn định.
- `github-action`: kiểm tra SVG đã commit có khớp source trên pull request.
- `deploy`: Compose self-hosted, chỉ expose Gateway.

## Luồng sử dụng

Developer sửa file trong `docs/diagrams`, mở preview và dùng `Diagram: Export SVG` khi muốn cập nhật artifact. Họ commit cả source text và SVG. Pull request hiển thị text diff lẫn GitHub image diff; Action gọi cùng Gateway và fail nếu SVG cũ.

## Cài đặt cho người dùng

### VS Code extension

Cài `phuongnam.diagram-as-code-vscode` từ **Visual Studio Marketplace**, sau đó cấu hình Gateway URL và chạy `Diagram: Set Gateway API Key` một lần. Extension cung cấp nút Preview và Export trên editor của các file sơ đồ được hỗ trợ.

### Windows Server

Máy Windows cần Docker Desktop đang chạy. Tải `diagram-as-code-server-0.2.0.zip` từ GitHub Release `product-v0.2.0`, giải nén rồi chạy:

```powershell
.\diagram-server.ps1 install
```

Installer kéo các image đã khóa version, chỉ mở Gateway tại `http://127.0.0.1:9000`, tự sinh API key và chờ dịch vụ sẵn sàng. Xem đầy đủ lệnh cài đặt, cập nhật và rollback trong [Windows Installer](windows-installer/README.md).

## Chạy local

1. Làm theo [Environment Bootstrap](docs/environment-bootstrap.md).
2. Tạo `product/deploy/.env`, rồi chạy `docker compose up -d --build` trong `product/deploy`.
3. Chạy `npm run smoke` trong `product` với `DIAGRAM_API_KEY` đã đặt.
4. Copy `product/.diagramrc.example.yml` thành `.diagramrc.yml` ở repo sử dụng.
5. Build/cài VSIX từ `product/vscode-extension/dist/diagram-as-code-vscode.vsix`.

Các quy trình TLS, key rotation, update và rollback nằm trong [Infrastructure and Operations](docs/infrastructure-operations.md). Quy trình đóng gói, phát hành và rollback version nằm trong [Release Guide](docs/release-guide.md).

## Phạm vi MVP

MVP chỉ nhận `.mmd`, `.puml`, `.dot`, `.d2` và chỉ tạo SVG. Không tự quét source code ứng dụng để suy ra kiến trúc, không tự export khi save, không tự commit từ CI, và chưa có playground, database, Redis hay SaaS billing.
