# Release Guide

Quy trình này chuẩn bị release ở local. Người vận hành tự thực hiện mọi thao tác Git, GitHub, GHCR và Visual Studio Marketplace.

## 1. Kiểm tra trước release

1. Xác nhận mọi package có version `0.2.1` và release notes tồn tại tại `product/docs/releases/0.2.1.md`.
2. Chạy `git status` và chỉ giữ những thay đổi chủ đích.
3. Export lại mọi SVG đã cũ rồi chạy Diagram Check.
4. Xác nhận Docker Desktop đang chạy nếu cần build hoặc smoke test Gateway image.

## 2. Chuẩn bị artifact local

Trong `product`, chạy:

```powershell
npm ci
npm run release:prepare
```

Lệnh này chạy audit, typecheck, test, build và tạo thư mục:

```text
product/release/product-v0.2.1/
```

Các artifact chính gồm:

- `diagram-as-code-vscode-0.2.1.vsix`
- `diagram-as-code-server-0.2.1.zip`
- `diagram-as-code-action-0.2.1.cjs`
- `manifest.json`, `RELEASE_NOTES.md` và `SHA256SUMS`

Đây là output local bị Git ignore, không commit. Kiểm tra checksum trước khi phát hành:

```powershell
Get-FileHash .\release\product-v0.2.1\diagram-as-code-server-0.2.1.zip -Algorithm SHA256
Get-Content .\release\product-v0.2.1\SHA256SUMS
```

## 3. Kiểm tra Gateway image

```powershell
cd D:\upgrade-diagram-as-code\product
docker build -f gateway/Dockerfile -t diagram-as-code-gateway:0.2.1 .
docker image inspect diagram-as-code-gateway:0.2.1
```

Trước khi publish, xác nhận `/health`, `/ready` và bốn renderer. Windows installer sẽ dùng image public trên **GHCR**, vì vậy sau release cần kiểm tra package có thể pull mà không cần đăng nhập.

## 4. Git và GitHub do người vận hành thực hiện

Sau khi xem diff và kết quả kiểm thử, người vận hành tự commit, push và tạo tag theo quy trình của repository. Tag cần phát hành là:

```text
product-v0.2.1
```

Tag `product-v0.2.1` kích hoạt `Product Release`. Workflow publish Gateway image lên GHCR trước, sau đó kiểm tra và tạo GitHub Release chứa cả VSIX lẫn `diagram-as-code-server-0.2.1.zip`. Không tạo tag trước khi commit chuẩn bị release đã có mặt trên remote.

## 5. Publish Marketplace thủ công

Làm theo [Marketplace Publishing](marketplace-publishing.md) để upload VSIX dưới publisher `phuongnam`. Đây là bước thủ công; workflow không lưu Personal Access Token của Marketplace.

Marketplace extension ID sau khi publish:

```text
phuongnam.diagram-as-code-vscode
```

## 6. Xác nhận sau release

- Tải VSIX và Windows ZIP từ GitHub Release, rồi đối chiếu `SHA256SUMS`.
- Cài VSIX trên VS Code sạch và kiểm tra listing công khai trên Visual Studio Marketplace.
- Trên máy Windows có Docker Desktop, chạy `diagram-server.ps1 install`, kiểm tra `status`, Preview và Export.
- Xác nhận Gateway image trên GHCR public có thể pull theo tag `product-v0.2.1`.
- Xác nhận Action bằng một repository thử nghiệm trước khi bật required check.

## Nâng cấp từ 0.1.0

1. Lưu lại giá trị `DIAGRAM_API_KEYS` của stack cũ.
2. Dừng Docker Compose `0.1.0` để giải phóng port `9000`.
3. Tạo `%LOCALAPPDATA%\DiagramAsCode\server\.env` với dòng `DIAGRAM_API_KEYS=<key-cu>`.
4. Giải nén Windows ZIP `0.2.1` rồi chạy `install`. Installer đọc `.env` đã có và giữ nguyên key.
5. Chạy `status` để xác nhận dịch vụ sẵn sàng.
6. Extension Marketplace có ID mới; nhập lại API key bằng `Diagram: Set Gateway API Key` vì VS Code SecretStorage không được chuyển từ extension cài thủ công cũ.

## Rollback

- Extension: cài lại VSIX của version ổn định trước đó.
- Windows server: lệnh `update` tự khôi phục package và Compose cũ nếu readiness thất bại.
- Gateway thủ công: đổi `GATEWAY_IMAGE` về tag cũ rồi chạy lại Compose.
- GitHub Action: đổi `uses: ...@product-vX.Y.Z` về tag cũ.
- Không di chuyển hoặc ghi đè release tag đã phát hành; tạo patch version mới cho bản sửa.
