# Tài liệu kỹ thuật Diagram as Code

## Sinh API key để làm gì vậy?

API key dùng để xác thực client nào được phép gọi Gateway để render sơ đồ.

```text
VS Code extension ── API key ──► Gateway
GitHub Action ────── API key ──► Gateway
```

Khi Gateway nhận request:

- Key hợp lệ: Gateway cho phép render.
- Thiếu key hoặc key không hợp lệ: Gateway trả về `401 Unauthorized`.

API key giúp ngăn một chương trình không được phép gọi Gateway liên tục, gửi source ngoài ý muốn hoặc tiêu tốn tài nguyên render. Key này chỉ bảo vệ Gateway, không liên quan đến tài khoản GitHub hoặc Visual Studio Marketplace.

Gateway từ phiên bản `0.2.0` chỉ lắng nghe tại `127.0.0.1`, nhưng vẫn nên giữ API key để tăng mức bảo vệ và duy trì hành vi thống nhất giữa VS Code extension và GitHub Action.

Installer sẽ tự sinh key. Người dùng chỉ cần nhập key một lần vào:

- Lệnh `Diagram: Set Gateway API Key` trong VS Code.
- GitHub repository secret `DIAGRAM_API_KEY`.

## API key được sinh ra từ đâu?

API key được sinh trực tiếp trên máy Windows của người dùng khi chạy:

```powershell
.\diagram-server.ps1 install
```

Installer sử dụng bộ sinh số ngẫu nhiên bảo mật của Windows:

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()

$apiKey = [Convert]::ToBase64String($bytes)
```

Kết quả là một key ngẫu nhiên 256-bit được mã hóa Base64.

Key này:

- Không được tải từ GitHub.
- Không được tạo bởi Docker hoặc Marketplace.
- Không được gửi tới hệ thống bên ngoài.
- Chỉ được tạo và lưu trên máy Windows hiện tại.

Installer lưu key tại:

```text
%LOCALAPPDATA%\DiagramAsCode\server\.env
```

Trong file `.env`, key nằm dưới biến:

```env
DIAGRAM_API_KEYS=<key-vừa-sinh>
```

Docker Compose truyền biến này vào Gateway. Installer cần giới hạn quyền đọc file `.env` cho tài khoản Windows hiện tại.

Cùng một key được sử dụng cho Gateway, VS Code extension và GitHub Action:

```text
.env của server
      │
      ├──► Gateway dùng để xác thực request
      ├──► VS Code SecretStorage lưu cho extension
      └──► GitHub Secret cung cấp cho GitHub Action
```

Khi chạy lại `install` hoặc `update`, installer giữ nguyên key hiện tại. Chỉ lệnh `rotate-key` mới sinh key mới.

## Lệnh install sẽ làm gì?

> Phần này mô tả Windows installer từ phiên bản `0.2.1`. Bản `0.1.0` cài server bằng Docker Compose thủ công; không nên dùng installer `0.2.0` trên Windows PowerShell 5.1.

Người dùng chạy lệnh sau trên máy Windows dùng chung cho VS Code và self-hosted runner:

```powershell
.\diagram-server.ps1 install
```

Lệnh `install` sẽ tự động thực hiện các bước:

1. Kiểm tra hệ điều hành Windows và phiên bản PowerShell.
2. Kiểm tra Docker Desktop đang được cài đặt và Docker Engine đang hoạt động.
3. Kiểm tra port `9000` chưa bị chương trình khác sử dụng.
4. Tạo thư mục cài đặt:

   ```text
   %LOCALAPPDATA%\DiagramAsCode\server
   ```

5. Sinh API key ngẫu nhiên 256-bit nếu chưa có key.
6. Tạo file `.env` và cấu hình Docker Compose từ manifest đã khóa version.
7. Pull các image cần thiết:
   - Diagram as Code Gateway từ GHCR public.
   - Kroki và Mermaid từ registry chính thức của Kroki.
8. Chỉ bind Gateway vào `127.0.0.1:9000`, không mở Gateway ra mạng LAN hoặc Internet.
9. Khởi động Gateway, Kroki và Mermaid bằng Docker Compose.
10. Chờ endpoint `/ready` xác nhận toàn bộ đường render đã sẵn sàng.
11. Hiển thị kết quả cài đặt gồm:

    ```text
    Gateway URL: http://localhost:9000
    API key: <key-vừa-sinh>
    Status: Ready
    ```

Sau khi cài đặt, người dùng dùng Gateway URL và API key để cấu hình:

- VS Code extension thông qua lệnh `Diagram: Set Gateway API Key`.
- GitHub repository variable `DIAGRAM_GATEWAY_URL`.
- GitHub repository secret `DIAGRAM_API_KEY`.

Chạy lại `install` phải an toàn: installer tái sử dụng cấu hình và API key hiện tại thay vì tạo một hệ thống hoặc key mới.

## File cài đặt server có tự dùng Docker Desktop để kéo image và chạy service không?

Có. Gói `diagram-as-code-server-0.2.1.zip` là một bộ điều khiển cài đặt nhỏ, không chứa sẵn toàn bộ Gateway và Kroki. Khi người dùng chạy:

```powershell
.\diagram-server.ps1 install
```

installer gọi Docker Desktop để:

1. Kéo Diagram as Code Gateway từ **GHCR** theo đúng tag của release.
2. Kéo Kroki và Mermaid từ registry chính thức theo version đã khóa.
3. Chạy các container bằng Docker Compose.
4. Kiểm tra `http://127.0.0.1:9000/ready` trước khi báo cài đặt thành công.

Luồng thực tế là:

```text
Windows installer -> Docker Desktop -> pull image từ GHCR/registry -> chạy container
```

Vì vậy máy đích cần Docker Desktop và kết nối Internet ở lần cài hoặc cập nhật đầu tiên. Sau khi image đã được tải, Docker Desktop quản lý vòng đời container; installer chỉ cung cấp các lệnh thống nhất như `status`, `logs`, `restart`, `update` và `uninstall`.
