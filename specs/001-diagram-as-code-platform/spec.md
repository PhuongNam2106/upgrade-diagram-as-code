# Đặc tả tính năng: Nền tảng Diagram as Code tự lưu trữ

**Nhánh tính năng**: `001-diagram-as-code-platform`  
**Ngày tạo**: 2026-07-22  
**Trạng thái**: Bản nháp  
**Đầu vào**: Xây dựng nền tảng biến source sơ đồ dạng văn bản thành hình vẽ, kèm công cụ VS Code và kiểm tra trên GitHub.

## Kịch bản người dùng và kiểm thử *(bắt buộc)*

### User Story 1 - Soạn thảo và Preview (Ưu tiên: P1)

Là lập trình viên, tôi muốn xem sơ đồ ngay khi sửa source trong VS Code để sơ đồ luôn đồng bộ với mã nguồn.

**Lý do ưu tiên**: Đây là luồng sử dụng cốt lõi của sản phẩm.

**Kiểm thử độc lập**: Mở Preview, sửa và lưu source, xác nhận Preview cập nhật nhưng không tự tạo file ảnh.

**Kịch bản chấp nhận**:

1. **Cho trước** source hợp lệ, **Khi** người dùng mở Preview, **Thì** sơ đồ xuất hiện bên cạnh editor.
2. **Cho trước** Preview đang mở, **Khi** source thay đổi liên tục, **Thì** chỉ kết quả mới nhất được hiển thị sau khoảng chờ cấu hình.
3. **Cho trước** file sơ đồ đang được mở, **Khi** người dùng xem giao diện, **Thì** các nút Preview và Export hiển thị rõ ràng.

### User Story 2 - Export artifact ổn định (Ưu tiên: P2)

Là lập trình viên, tôi muốn chủ động Export một SVG có đường dẫn ổn định để commit và review cùng source.

**Lý do ưu tiên**: Artifact cần hiển thị được ở mọi nơi nhưng không nên tự sinh sau mỗi lần lưu.

**Kiểm thử độc lập**: Export hai lần một source không đổi và xác nhận cùng đường dẫn, cùng nội dung, không tạo file trùng.

**Kịch bản chấp nhận**:

1. **Cho trước** source hợp lệ trong phạm vi dự án, **Khi** chọn Export, **Thì** SVG được ghi vào đường dẫn output tương ứng.
2. **Cho trước** artifact đã tồn tại, **Khi** Export lại, **Thì** artifact được thay thế an toàn.
3. **Cho trước** người dùng chỉ lưu source, **Khi** không chọn Export, **Thì** SVG không bị tạo hoặc thay đổi.

### User Story 3 - Kiểm tra khi review (Ưu tiên: P3)

Là reviewer, tôi muốn kiểm tra tự động source và SVG để ngăn sơ đồ sai lệch được merge.

**Lý do ưu tiên**: Kiểm tra tự động giúp quy trình đáng tin cậy và giảm phụ thuộc vào kiểm tra thủ công.

**Kiểm thử độc lập**: Chạy kiểm tra với artifact đúng, thiếu, cũ và mồ côi; xác nhận hệ thống báo chính xác từng trường hợp.

**Kịch bản chấp nhận**:

1. **Cho trước** source đã thay đổi nhưng SVG chưa cập nhật, **Khi** kiểm tra chạy, **Thì** kết quả thất bại và báo artifact đã cũ.
2. **Cho trước** SVG bị thiếu hoặc còn sót sau khi source bị xóa, **Khi** kiểm tra chạy, **Thì** artifact được báo là thiếu hoặc mồ côi.
3. **Cho trước** mọi artifact đều khớp, **Khi** kiểm tra chạy, **Thì** kết quả thành công.
4. **Cho trước** cấu hình render thay đổi, **Khi** kiểm tra chạy, **Thì** toàn bộ source được xác minh.

### User Story 4 - Vận hành self-hosted (Ưu tiên: P4)

Là người vận hành, tôi muốn chạy dịch vụ render trong mạng riêng để source nội bộ không phải gửi ra dịch vụ công cộng.

**Lý do ưu tiên**: Self-hosted và kiểm soát truy cập là điều kiện để tổ chức sử dụng sản phẩm.

**Kiểm thử độc lập**: Khởi động deployment sạch, kiểm tra trạng thái, render đủ bốn loại, thử sai API key và kiểm tra lại sau restart.

**Kịch bản chấp nhận**:

1. **Cho trước** dịch vụ sẵn sàng và API key hợp lệ, **Khi** client gửi source được hỗ trợ, **Thì** dịch vụ trả về SVG.
2. **Cho trước** API key thiếu hoặc sai, **Khi** client yêu cầu render, **Thì** truy cập bị từ chối.
3. **Cho trước** dịch vụ vừa restart, **Khi** trạng thái sẵn sàng được khôi phục, **Thì** cả bốn loại sơ đồ tiếp tục render được.

### Cách người dùng sử dụng hệ thống

**Thiết lập lần đầu**:

1. Người vận hành triển khai Gateway và các renderer, sau đó cấp API key cho nhóm sử dụng.
2. Chủ dự án thêm file cấu hình để xác định Gateway, thư mục source và thư mục SVG output.
3. Lập trình viên cài extension VS Code, mở dự án và lưu API key vào kho bí mật của editor.
4. Chủ repository cấu hình GitHub Action và runner có thể truy cập Gateway.

**Workflow hằng ngày**:

1. Lập trình viên tạo hoặc sửa file `.mmd`, `.puml`, `.dot` hoặc `.d2` trong thư mục source.
2. Người dùng bấm Preview; bản xem trước tự cập nhật khi source thay đổi nhưng chưa tạo SVG.
3. Khi sơ đồ hoàn tất, người dùng bấm Export để cập nhật SVG tại đường dẫn output ổn định.
4. Người dùng commit cả source và SVG, sau đó mở Pull Request.
5. GitHub Action render lại source và so sánh với SVG đã commit. Pull Request chỉ đạt khi artifact không bị thiếu, cũ hoặc mồ côi.

### Các trường hợp biên

- Source rỗng, quá lớn, sai cú pháp, sai phần mở rộng hoặc nằm ngoài thư mục cấu hình.
- Dịch vụ mất kết nối hoặc timeout trong lúc Preview hay Export.
- Source bị đổi tên, di chuyển hoặc xóa; SVG bị sửa trực tiếp.
- Nhiều thay đổi hoặc yêu cầu render giống nhau xảy ra đồng thời.
- Thư mục output không thể ghi hoặc API key được xoay vòng khi client đang hoạt động.

## Yêu cầu *(bắt buộc)*

### Yêu cầu chức năng

- **FR-001**: Hệ thống PHẢI hỗ trợ Mermaid, PlantUML, Graphviz/DOT và D2.
- **FR-002**: Hệ thống PHẢI dùng SVG làm artifact chuẩn và tạo kết quả ổn định cho cùng một đầu vào.
- **FR-003**: Hệ thống PHẢI kiểm tra request trước khi render và trả lỗi rõ ràng cho dữ liệu sai, timeout hoặc renderer không khả dụng.
- **FR-004**: Hệ thống PHẢI cung cấp trạng thái sống và trạng thái sẵn sàng của dịch vụ.
- **FR-005**: Thao tác render PHẢI yêu cầu API key hợp lệ; hệ thống PHẢI cho phép nhiều key trong giai đoạn xoay vòng.
- **FR-006**: Cấu hình dự án PHẢI xác định địa chỉ dịch vụ, vị trí source, mẫu file, vị trí output và độ trễ Preview.
- **FR-007**: API key của extension PHẢI được lưu trong kho bí mật của editor, không nằm trong source control.
- **FR-008**: Extension PHẢI cung cấp nút Preview và Export cho file được hỗ trợ.
- **FR-009**: Preview PHẢI cập nhật sau khoảng chờ và không cho kết quả cũ ghi đè kết quả mới.
- **FR-010**: Lưu source KHÔNG ĐƯỢC tự động tạo hoặc tải SVG.
- **FR-011**: Export PHẢI ghi một SVG vào đường dẫn ổn định, giữ cấu trúc thư mục và thay thế file an toàn.
- **FR-012**: Kiểm tra repository PHẢI xử lý source được thêm, sửa, xóa, đổi tên và SVG bị sửa trực tiếp.
- **FR-013**: Kiểm tra repository PHẢI phát hiện artifact bị thiếu, đã cũ hoặc mồ côi; thay đổi cấu hình PHẢI kích hoạt kiểm tra toàn bộ.
- **FR-014**: Kiểm tra repository PHẢI báo kết quả rõ ràng nhưng KHÔNG ĐƯỢC tự sửa file, commit hoặc đăng bình luận.
- **FR-015**: Deployment mặc định chỉ PHẢI mở Gateway cho client; các renderer nội bộ không được expose trực tiếp.
- **FR-016**: Hệ thống PHẢI cung cấp gói Windows cài đặt server có checksum, manifest khóa version, cài lại an toàn và rollback khi update thất bại.
- **FR-017**: Extension PHẢI có thể phát hành bằng publisher `phuongnam` trên Visual Studio Marketplace.

### Ranh giới phạm vi

- MVP chỉ hỗ trợ SVG và bốn loại sơ đồ đã nêu.
- Hệ thống không quét mã nguồn để tự suy luận kiến trúc.
- Hệ thống không Export khi lưu, tự commit hoặc tự sửa pull request.
- Playground, database, cache phân tán, PNG/PDF, billing và SaaS hosted nằm ngoài MVP.

### Thực thể chính

- **Diagram Source**: File văn bản được quản lý bằng Git.
- **Generated Artifact**: SVG tương ứng với một Diagram Source tại đường dẫn ổn định.
- **Project Configuration**: Quy định phạm vi source, output, dịch vụ render và hành vi Preview.
- **Verification Result**: Danh sách artifact hợp lệ, bị thiếu, đã cũ hoặc mồ côi.

## Tiêu chí thành công *(bắt buộc)*

### Kết quả đo lường được

- **SC-001**: Người dùng mới có thể cấu hình dự án, Preview và Export sơ đồ mẫu trong vòng 15 phút.
- **SC-002**: Ít nhất 95% sơ đồ đại diện dưới 100 KB hiển thị Preview trong vòng 3 giây.
- **SC-003**: Với 5 thay đổi mỗi giây, chỉ Preview mới nhất được hiển thị và editor vẫn phản hồi.
- **SC-004**: Export lặp lại source không đổi luôn tạo cùng đường dẫn và nội dung giống nhau từng byte.
- **SC-005**: Bộ kiểm thử phát hiện 100% artifact bị thiếu, đã cũ, mồ côi, đổi tên hoặc sửa trực tiếp.
- **SC-006**: Sau restart, dịch vụ sẵn sàng và render được cả bốn loại trong vòng 2 phút.
- **SC-007**: Người dùng Windows có Docker Desktop có thể cài server từ ZIP, lấy Gateway URL và API key mà không phải tự viết file Compose.
- **SC-008**: Artifact VSIX, Windows ZIP và Action bundle của cùng một release có version thống nhất và checksum kiểm chứng được.

## Giả định

- Người dùng đã quen với Git và commit source cùng SVG khi cần hiển thị độc lập.
- Dịch vụ render được triển khai trước khi cấu hình extension và GitHub Action.
- Self-hosted runner có thể truy cập Gateway khi Gateway nằm trong mạng riêng.
- Người vận hành chịu trách nhiệm về HTTPS, mạng, API key, giám sát và rollback.
