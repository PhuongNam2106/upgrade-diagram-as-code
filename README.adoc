# Hướng dẫn cài đặt và sử dụng Diagram as Code trên Windows

Tài liệu này dành cho người mới, không cần biết Docker, API hay lập trình. Hãy làm
lần lượt từng bước. Sau khi hoàn thành, bạn có thể viết một sơ đồ bằng văn bản,
xem trước trong VS Code và xuất thành ảnh SVG.

## 1. Hệ thống này làm gì?

Bạn viết nội dung sơ đồ trong một file văn bản, ví dụ `hello.mmd`. Diagram as Code
gửi nội dung đó đến server đang chạy trên máy của bạn và hiển thị sơ đồ trong VS
Code.

Hệ thống gồm hai phần:

- **Diagram as Code Server:** chuyển văn bản thành hình ảnh. Server chạy trong
  Docker Desktop trên chính máy Windows của bạn.
- **VS Code extension:** cung cấp nút Preview để xem trước và Export để lưu ảnh.

Docker Desktop phải đang chạy khi bạn Preview hoặc Export sơ đồ.

## 2. Cần chuẩn bị gì?

Máy tính cần có:

- Windows 10 hoặc Windows 11.
- Kết nối Internet trong lần cài đặt đầu tiên.
- [Visual Studio Code](https://code.visualstudio.com/download).
- [Docker Desktop](https://www.docker.com/products/docker-desktop/).
- Hai file tải từ
  [GitHub Release product-v0.3.0](https://github.com/PhuongNam2106/upgrade-diagram-as-code/releases/tag/product-v0.3.0):
  - `diagram-as-code-server-0.3.0.zip`
  - `diagram-as-code-vscode-0.3.0.vsix`

File ZIP là server. File VSIX là extension của VS Code.

## 3. Cài Docker Desktop

1. Cài Docker Desktop như một ứng dụng Windows bình thường.
2. Nếu Docker yêu cầu cài WSL 2 hoặc khởi động lại máy, hãy làm theo thông báo.
3. Mở Docker Desktop.
4. Chờ đến khi Docker báo engine đã sẵn sàng. Không đóng Docker Desktop trong lúc
   sử dụng Diagram as Code.

Bạn không cần tự tạo container hay gõ lệnh Docker. Bộ cài server sẽ làm việc đó.

## 4. Cài Diagram as Code Server

### Bước 4.1: Giải nén

1. Bấm chuột phải vào `diagram-as-code-server-0.3.0.zip`.
2. Chọn **Extract All...** hoặc **Giải nén tất cả**.
3. Mở thư mục vừa giải nén, sau đó mở thư mục `server`.

Không chạy bộ cài trực tiếp bên trong file ZIP.

### Bước 4.2: Mở PowerShell đúng thư mục

1. Trong cửa sổ thư mục `server`, bấm vào thanh địa chỉ ở phía trên.
2. Gõ `powershell` và nhấn Enter.
3. Một cửa sổ PowerShell sẽ mở tại đúng thư mục đó.

### Bước 4.3: Cài server

Dán lệnh sau vào PowerShell và nhấn Enter:

```powershell
powershell -ExecutionPolicy Bypass -File .\diagram-server.ps1 install
```

Lần đầu có thể mất vài phút vì Docker cần tải các image. Cài đặt thành công khi
màn hình hiển thị:

```text
Gateway URL: http://localhost:9000
API key: ...
Status: Ready
```

Hãy giữ kín API key. Đây là mật khẩu để extension được phép gọi server. Không gửi
key lên GitHub và không đặt key trong tài liệu của dự án.

### Bước 4.4: Kiểm tra server

Chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\diagram-server.ps1 status
```

Nếu thấy `Status: Ready`, server đã sẵn sàng.

Nếu quên API key, mở PowerShell trong thư mục `server` và chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\diagram-server.ps1 show-key
```

### Bước 4.5: Thử nhanh bằng Playground

Mở trình duyệt và truy cập:

```text
http://localhost:9000/playground
```

Dán API key vào ô **API key**, bấm **Save**, chọn loại sơ đồ rồi bấm **Render**.
Playground dùng cùng server với extension, nên nếu Playground render được thì server
đang hoạt động đúng.

## 5. Cài extension vào VS Code

1. Mở VS Code.
2. Bấm biểu tượng **Extensions** ở thanh bên trái.
3. Bấm nút ba chấm `...` ở góc trên của khung Extensions.
4. Chọn **Install from VSIX...**.
5. Chọn file `diagram-as-code-vscode-0.3.0.vsix` đã tải.
6. Nếu VS Code hiện nút **Reload** hoặc yêu cầu khởi động lại, hãy bấm nút đó.

## 6. Tạo dự án sơ đồ đầu tiên

### Bước 6.1: Mở một thư mục làm việc

1. Tạo thư mục, ví dụ `D:\My-Diagrams`.
2. Trong VS Code, chọn **File > Open Folder...**.
3. Chọn thư mục `D:\My-Diagrams`.
4. Nếu VS Code hỏi có tin tưởng thư mục hay không, chọn tin tưởng nếu đây là thư
   mục do chính bạn tạo.

### Bước 6.2: Tạo file cấu hình

Trong khung Explorer của VS Code, tạo file tên chính xác là `.diagramrc.yml` tại
thư mục gốc `My-Diagrams`. Dán nội dung sau vào file:

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

File này cho extension biết server ở đâu, file sơ đồ nằm ở đâu và ảnh sẽ được
lưu ở đâu. File này không chứa API key nên có thể đưa lên Git.

### Bước 6.3: Tạo file sơ đồ Mermaid

1. Tạo thư mục `docs`.
2. Trong `docs`, tạo thư mục `diagrams`.
3. Trong `docs/diagrams`, tạo file `hello.mmd`.
4. Dán nội dung sau và nhấn `Ctrl + S`:

```mermaid
flowchart LR
    A[Bắt đầu] --> B[Thực hiện công việc]
    B --> C[Hoàn tất]
```

Cấu trúc thư mục lúc này sẽ như sau:

```text
My-Diagrams/
|-- .diagramrc.yml
`-- docs/
    `-- diagrams/
        `-- hello.mmd
```

## 7. Kết nối extension với server

1. Đảm bảo Docker Desktop đang chạy và server có trạng thái `Ready`.
2. Mở file `hello.mmd` trong VS Code.
3. Nhấn `Ctrl + Shift + P` để mở Command Palette.
4. Gõ và chọn `Diagram: Set Gateway API Key`.
5. Dán API key mà server đã tạo, sau đó nhấn Enter.

API key được lưu trong kho bảo mật SecretStorage của VS Code. Bạn không cần nhập
key vào `.diagramrc.yml` hoặc file `.env` của dự án.

## 8. Xem trước và xuất ảnh

### Xem trước

Khi đang mở `hello.mmd`, bấm nút **Preview** trên thanh trạng thái hoặc ở góc trên
của trình soạn thảo. Bạn cũng có thể nhấn `Ctrl + Shift + P` và chọn
`Diagram: Open Preview`.

Sơ đồ sẽ mở ở một khung bên cạnh. Khi bạn sửa nội dung và nhấn `Ctrl + S`, bản xem
trước sẽ được cập nhật. Việc Save chỉ cập nhật Preview, không tự tải nhiều file
ảnh về máy.

### Xuất ảnh SVG

Chỉ bấm **Export** khi bạn thực sự muốn lưu ảnh. Bạn cũng có thể chạy
`Diagram: Export SVG` từ Command Palette.

Với ví dụ trên, ảnh được lưu tại:

```text
docs/generated/hello.svg
```

Nếu Export lại cùng một sơ đồ, file SVG cũ được cập nhật thay vì tạo thêm nhiều
bản sao.

## 9. Cách sử dụng hằng ngày

Mỗi lần muốn làm việc với sơ đồ:

1. Mở Docker Desktop và chờ Docker sẵn sàng.
2. Mở thư mục dự án trong VS Code.
3. Mở file `.mmd`, `.puml`, `.dot` hoặc `.d2`.
4. Bấm Preview để xem sơ đồ.
5. Sửa nội dung và nhấn `Ctrl + S` để cập nhật bản xem trước.
6. Bấm Export khi muốn cập nhật file SVG chính thức.

Không cần chạy lại lệnh `install` mỗi ngày. Nếu server dừng, có thể khởi động lại
bằng lệnh `restart` ở phần dưới.

## 10. Xử lý lỗi thường gặp

### Lỗi `A valid bearer API key is required`

Extension chưa có key hoặc key không đúng.

1. Chạy `show-key` trong thư mục server.
2. Trong VS Code, chạy `Diagram: Set Gateway API Key`.
3. Dán lại key mới nhất.

### Lỗi không đọc được `.diagramrc.yml`

Kiểm tra:

- Bạn đã mở cả thư mục dự án bằng **File > Open Folder...**, không chỉ mở riêng
  file `hello.mmd`.
- `.diagramrc.yml` nằm ngay tại thư mục gốc.
- Tên file không bị thành `.diagramrc.yml.txt`.

### Preview không hiện ảnh

1. Kiểm tra Docker Desktop đang chạy.
2. Chạy lệnh `status` của server.
3. Kiểm tra nội dung file sơ đồ có đúng cú pháp hay không.
4. Bấm **Refresh Preview** hoặc đóng Preview và mở lại.

### Docker báo chưa sẵn sàng

Mở Docker Desktop, đợi đến khi engine sẵn sàng, sau đó chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\diagram-server.ps1 restart
```

### Cần xem log để tìm lỗi

Trong thư mục `server`, chạy:

```powershell
powershell -ExecutionPolicy Bypass -File .\diagram-server.ps1 logs -Tail 200
```

### Cổng `9000` đang được sử dụng

Một ứng dụng khác hoặc bản Diagram as Code cũ có thể đang dùng cổng này. Hãy đóng
bản server cũ, sau đó chạy lại `install`. Nếu không biết ứng dụng nào đang dùng
cổng, hãy gửi nội dung lỗi cho người hỗ trợ kỹ thuật.

## 11. Khởi động lại hoặc gỡ cài đặt server

Mở PowerShell trong thư mục `server`.

Khởi động lại:

```powershell
powershell -ExecutionPolicy Bypass -File .\diagram-server.ps1 restart
```

Gỡ các container nhưng giữ cấu hình và API key:

```powershell
powershell -ExecutionPolicy Bypass -File .\diagram-server.ps1 uninstall
```

Gỡ hoàn toàn cả cấu hình và API key:

```powershell
powershell -ExecutionPolicy Bypass -File .\diagram-server.ps1 uninstall -Purge
```

Chỉ dùng `-Purge` khi bạn chắc chắn không cần API key và cấu hình cũ.

## 12. Ghi nhớ ba điều

1. Docker Desktop phải đang chạy để Preview và Export.
2. Không chia sẻ hoặc commit API key lên Git.
3. Save cập nhật bản xem trước; Export mới ghi file SVG vào thư mục
   `docs/generated`.
