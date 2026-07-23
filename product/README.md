# Diagram as Code Product

Lớp sản phẩm này bổ sung workflow hoàn chỉnh quanh fork Kroki mà không trộn code tùy biến vào module upstream:

- `gateway`: Fastify API có API key, validation, timeout, LRU và single-flight.
- `vscode-extension`: live preview và export SVG thủ công, ổn định.
- `github-action`: kiểm tra SVG đã commit có khớp source trên pull request.
- `deploy`: Compose self-hosted, chỉ expose Gateway.

## Hướng dẫn sử dụng nhanh

Người mới có thể xem tài liệu từng bước tại
[Hướng dẫn cài đặt và sử dụng trên Windows](docs/huong-dan-su-dung-windows.md).

### 1. Cài server và extension

1. Mở Docker Desktop.
2. Giải nén `diagram-as-code-server-0.2.1.zip` và chạy
   `powershell -ExecutionPolicy Bypass -File .\diagram-server.ps1 install` trong
   thư mục `server`.
3. Ghi lại Gateway URL `http://localhost:9000` và API key do installer tạo.
4. Cài `diagram-as-code-vscode-0.2.1.vsix` bằng chức năng
   **Extensions > Install from VSIX...** của VS Code.

### 2. Cấu hình dự án

Tạo `.diagramrc.yml` tại thư mục gốc của dự án:

```yaml
version: 1
server:
  url: http://localhost:9000
  apiKeyEnv: DIAGRAM_API_KEY
sources:
  directory: docs/diagrams
  include:
    - "**/*.mmd"
    - "**/*.puml"
    - "**/*.dot"
    - "**/*.d2"
output:
  directory: docs/generated
  format: svg
preview:
  debounceMs: 600
render:
  onSave: changed
  exportOnSave: false
```

Tạo các file sơ đồ trong `docs/diagrams`. Hệ thống hỗ trợ Mermaid `.mmd`,
PlantUML `.puml`, Graphviz `.dot` và D2 `.d2`.

### 3. Nhập API key

Mở một file sơ đồ, nhấn `Ctrl + Shift + P`, chạy
`Diagram: Set Gateway API Key` và dán API key do installer tạo. Extension lưu key
trong VS Code SecretStorage; không ghi API key vào source hoặc commit lên Git.

### 4. Preview và Export

- Bấm **Preview** để xem sơ đồ bên cạnh trình soạn thảo.
- Khi Preview đang mở, `Ctrl + S` cập nhật bản xem trước nhưng không tạo thêm file
  ảnh.
- Bấm **Export** hoặc chạy `Diagram: Export SVG` khi muốn ghi ảnh vào
  `docs/generated`.
- Export lại cùng một sơ đồ sẽ cập nhật file SVG cũ thay vì tạo nhiều bản sao.

Trong workflow nhóm, developer commit cả source text và SVG. Pull request hiển
thị text diff lẫn image diff; GitHub Action gọi cùng Gateway và fail nếu SVG đã
cũ so với source.

## Cài đặt cho người dùng

### VS Code extension

Cài `phuongnam.diagram-as-code-vscode` từ **Visual Studio Marketplace** khi bản
Marketplace đã được phát hành, hoặc tải file VSIX từ
[GitHub Release product-v0.2.1](https://github.com/PhuongNam2106/upgrade-diagram-as-code/releases/tag/product-v0.2.1).
Sau đó cấu hình Gateway URL và chạy `Diagram: Set Gateway API Key` một lần.
Extension cung cấp nút Preview và Export trên editor của các file sơ đồ được hỗ
trợ.

### Windows Server

Máy Windows cần Docker Desktop đang chạy. Tải `diagram-as-code-server-0.2.1.zip` từ GitHub Release `product-v0.2.1`, giải nén rồi chạy:

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
