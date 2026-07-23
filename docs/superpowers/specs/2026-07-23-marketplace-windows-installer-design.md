# Thiết kế phát hành Marketplace và Windows Server Installer

**Ngày**: 2026-07-23  
**Phiên bản mục tiêu**: `0.2.0`  
**Trạng thái**: Đã duyệt

## 1. Mục tiêu

Phiên bản `0.2.0` giảm quy trình tiếp nhận hệ thống xuống hai thao tác chính:

1. Developer cài extension `Diagram as Code` trực tiếp từ VS Code Marketplace.
2. Người quản trị chạy một PowerShell installer để cài Gateway, Kroki và Mermaid trên máy Windows hiện tại.

Người dùng cuối không cần clone source code sản phẩm, chạy `npm`, tự tạo API key hoặc tự chỉnh Docker Compose.

## 2. Các quyết định đã chốt

- Marketplace publisher ID: `phuongnam`.
- Extension ID: `phuongnam.diagram-as-code-vscode`.
- Lần phát hành Marketplace đầu tiên được upload thủ công bằng VSIX.
- Gateway image được publish công khai trên GHCR.
- Server installer được phát hành dạng ZIP trong GitHub Release.
- Máy đích là máy Windows hiện tại có Docker Desktop.
- Gateway chỉ phục vụ VS Code và self-hosted runner trên cùng máy.
- Gateway chỉ bind vào `127.0.0.1:9000`, không mở ra LAN hoặc Internet.
- Authentication bằng API key vẫn được bật.
- Kubernetes, MSI và extension tự quản lý Docker nằm ngoài `0.2.0`.

## 3. Kiến trúc

```text
VS Code extension ───── API key ────┐
                                     ├── Gateway: 127.0.0.1:9000
Self-hosted runner ──── API key ────┘             │
                                                   ▼
                                         Kroki + Mermaid
                                         trong Docker Desktop
```

Chỉ Gateway publish port ra host. Kroki và Mermaid chỉ giao tiếp trong Docker network.

## 4. Phát hành extension trên Marketplace

### 4.1 Danh tính và metadata

Extension sử dụng:

```text
Publisher: phuongnam
Package: diagram-as-code-vscode
Display name: Diagram as Code
```

Manifest cần:

- Bỏ trạng thái package private.
- Đổi publisher thành `phuongnam`.
- Nâng version lên `0.2.0` đồng bộ với release sản phẩm.
- Bổ sung icon PNG tối thiểu 128x128.
- Bổ sung homepage, issue tracker, keywords và metadata Marketplace.
- Cập nhật README với hướng dẫn kết nối Gateway và workflow Preview/Export.

### 4.2 Quy trình phát hành

1. Chạy audit, typecheck, test và build.
2. Package VSIX và kiểm tra danh sách file trong gói.
3. Cài VSIX trên một VS Code profile sạch.
4. Kiểm thử Preview, cập nhật Preview, Export và SecretStorage.
5. Người vận hành đăng nhập publisher `phuongnam` và upload VSIX thủ công.
6. Cài lại extension từ Marketplace và lặp lại smoke test.

Không lưu Marketplace PAT trong repository cho `0.2.0`. Tự động publish bằng Microsoft Entra ID được xem xét ở phiên bản sau.

### 4.3 Chuyển đổi từ bản thử nghiệm

Publisher cũ và mới tạo ra hai extension ID khác nhau. Người đã cài VSIX thử nghiệm phải:

1. Gỡ `diagram-as-code.diagram-as-code-vscode`.
2. Cài `phuongnam.diagram-as-code-vscode` từ Marketplace.
3. Nhập lại Gateway API key một lần vì SecretStorage thuộc phạm vi extension ID.

## 5. Windows Server Installer

### 5.1 Gói phát hành

GitHub Release chứa:

```text
diagram-as-code-server-0.2.0.zip
├── diagram-server.ps1
├── DiagramServer.psm1
├── docker-compose.yml
├── server-manifest.json
├── README.md
├── LICENSE
└── SHA256SUMS
```

ZIP không chứa Docker image. Installer pull Gateway từ GHCR public và pull Kroki/Mermaid theo version đã khóa trong manifest.
`SHA256SUMS` trong ZIP bảo vệ các file đã giải nén; file `SHA256SUMS` ngoài ZIP trên GitHub Release bảo vệ chính artifact ZIP khi tải về.

### 5.2 Lệnh quản trị

```powershell
.\diagram-server.ps1 install
.\diagram-server.ps1 status
.\diagram-server.ps1 logs
.\diagram-server.ps1 restart
.\diagram-server.ps1 update -Version 0.2.1
.\diagram-server.ps1 rotate-key
.\diagram-server.ps1 rotate-key -Finalize
.\diagram-server.ps1 uninstall
.\diagram-server.ps1 uninstall -Purge
```

Mỗi lệnh trả exit code khác `0` khi thất bại và in thông báo ngắn gọn kèm hành động khắc phục.

### 5.3 Trạng thái cài đặt

Installer lưu trạng thái tại:

```text
%LOCALAPPDATA%\DiagramAsCode\server
├── .env
├── docker-compose.yml
├── server-manifest.json
└── backups\
```

File `.env` chứa `DIAGRAM_API_KEYS` và chỉ tài khoản Windows hiện tại được đọc. Source dự án và SVG không được lưu trong thư mục này.

### 5.4 Luồng install

`install` thực hiện tuần tự:

1. Kiểm tra Windows, PowerShell và Docker Desktop.
2. Kiểm tra Docker Engine đang hoạt động.
3. Kiểm tra port `9000` còn trống.
4. Tạo thư mục cài đặt nếu chưa tồn tại.
5. Sinh API key ngẫu nhiên 256-bit nếu chưa có key.
6. Tạo `.env` và cấu hình từ manifest versioned.
7. Pull Gateway, Kroki và Mermaid images.
8. Bind Gateway vào `127.0.0.1:9000`.
9. Khởi động Docker Compose stack với project name cố định.
10. Chờ `/ready` tối đa 120 giây.
11. In Gateway URL, API key và hướng dẫn cấu hình client.

Chạy lại `install` là idempotent: cấu hình và API key hiện có được giữ nguyên, container thiếu được khôi phục và stack không bị tạo trùng.

### 5.5 Update và rollback

`update` nhận version đích, tải ZIP cùng `SHA256SUMS` của GitHub Release tương ứng, xác minh checksum và thực hiện:

1. Sao lưu `.env`, Compose và manifest hiện tại.
2. Pull image version mới.
3. Khởi động lại stack.
4. Kiểm tra `/health`, `/ready` và bốn renderer.
5. Giữ nguyên API key nếu kiểm tra thành công.
6. Tự phục hồi cấu hình và image version cũ nếu kiểm tra thất bại.

### 5.6 Xoay API key

`rotate-key` tạo key mới và tạm thời giữ key cũ để client không bị ngắt ngay lập tức. Sau khi người dùng cập nhật VS Code SecretStorage và GitHub Secret, chế độ finalize loại bỏ key cũ và restart Gateway.

Key không được in trong log Docker hoặc lưu vào repository.

### 5.7 Uninstall

`uninstall` dừng và xóa container, network do installer quản lý. Cấu hình và API key được giữ mặc định để có thể cài lại; tùy chọn purge yêu cầu xác nhận rõ ràng trước khi xóa toàn bộ thư mục trạng thái.

Installer không xóa image hoặc Docker stack không thuộc Diagram as Code.

## 6. Xử lý lỗi

- Docker chưa cài: dừng và hiển thị đường dẫn hướng dẫn cài Docker Desktop.
- Docker Engine chưa chạy: yêu cầu mở Docker Desktop rồi chạy lại.
- Port `9000` bị chiếm: báo process/port và không sửa cấu hình hiện có.
- GHCR hoặc Docker Hub không truy cập được: giữ trạng thái cũ và cho phép retry.
- `/ready` timeout: hiển thị log rút gọn và rollback nếu đang update.
- `.env` hỏng hoặc thiếu key: không tự ghi đè; yêu cầu người dùng khôi phục backup hoặc xác nhận tạo key mới.
- Thiếu quyền file: dừng trước khi khởi động container và hướng dẫn sửa quyền.

## 7. Kiểm thử

### 7.1 Marketplace

- Package không chứa file phát triển hoặc secret.
- Icon và liên kết Marketplace hợp lệ.
- Cài mới, kích hoạt theo bốn loại file và hiển thị các nút đúng.
- Preview, debounce, error state và Export hoạt động với Gateway `0.2.0`.
- Gỡ và cài lại extension không làm thay đổi source hoặc SVG dự án.

### 7.2 Installer

- PowerShell 5.1 và PowerShell 7.
- Cài mới với Docker Desktop đang chạy.
- Docker chưa chạy, port bận và registry mất kết nối.
- Chạy `install` lặp lại không đổi API key.
- Render Mermaid, PlantUML, Graphviz/DOT và D2.
- Docker Desktop restart rồi stack tự phục hồi.
- Update thành công và rollback khi readiness thất bại.
- Rotate key theo hai giai đoạn.
- Uninstall không ảnh hưởng stack Docker khác.

## 8. Phát hành và bàn giao

Tag `product-v0.2.0` tạo các artifact sau:

- VSIX để upload lên Marketplace.
- Windows server installer ZIP.
- Gateway image public trên GHCR.
- GitHub Action bundle và deployment files.
- Manifest, release notes và SHA-256 checksums.

Tài liệu bàn giao gồm hai luồng:

- Admin: cài Docker Desktop, chạy installer, cấu hình runner và GitHub secrets.
- Developer: cài extension Marketplace, nhập API key, Preview, Export và mở Pull Request.

## 9. Ngoài phạm vi

- Gateway cho nhiều máy qua LAN/VPN hoặc Internet.
- TLS/reverse proxy do installer quản lý.
- MSI, Winget hoặc Windows Service riêng.
- Extension tự cài hoặc điều khiển Docker.
- Hosted SaaS, tài khoản người dùng và billing.
- Marketplace publish tự động.
