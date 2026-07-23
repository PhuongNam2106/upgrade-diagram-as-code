# Kiểm thử Windows Server Installer

Thực hiện checklist này trên máy Windows có Docker Desktop trước khi phát hành.

1. Xác nhận Docker Desktop đang chạy và port `9000` còn trống.
2. Giải nén `diagram-as-code-server-0.2.1.zip` vào thư mục tạm.
3. Chạy `powershell -ExecutionPolicy Bypass -File .\diagram-server.ps1 install`.
4. Chạy `status`; kết quả phải có `Running=True` và `Ready=True`.
5. Lấy key bằng `show-key` và gọi render thật:

```powershell
$key = powershell -ExecutionPolicy Bypass -File .\diagram-server.ps1 show-key
$headers = @{ Authorization = "Bearer $key" }
$body = @{ type = "mermaid"; format = "svg"; source = "graph TD; A-->B" } |
  ConvertTo-Json -Compress
Invoke-WebRequest `
  -Method Post `
  -Uri "http://localhost:9000/v1/render" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

6. Restart Docker Desktop và xác nhận stack tự trở lại.
7. Chạy lại `install` và xác nhận API key không đổi.
8. Chạy `rotate-key`, cập nhật client, rồi chạy `rotate-key -Finalize`.
9. Thử update lỗi và xác nhận installer báo `rolled back`.
10. Chạy `uninstall`, cài lại để kiểm tra key được giữ; cuối cùng dùng `uninstall -Purge`.

Không ghi API key vào tài liệu kết quả kiểm thử.
