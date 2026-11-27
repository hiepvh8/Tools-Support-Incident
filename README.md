# NOC Hub

Ứng dụng hỗ trợ kỹ sư NOC tạo bản tin sự cố, lưu lịch sử điều phối, quản lý đầu mối và tra cứu hướng xử lý alert theo thị trường.

## Chạy ứng dụng

Yêu cầu Node.js 24 và npm. Tại thư mục repo, chạy:

```bash
npm ci
npm run dev
```

Mở địa chỉ Vite được in trong terminal. Server API chạy trên cổng 3001. Để chạy bản build:

```bash
npm run build
npm start
```

Mở ứng dụng qua cổng 3001. Có thể đổi cổng server bằng biến `PORT`.

## Kết nối AI

Để phân tích hình ảnh, tạo nội dung dựa trên toàn bộ ngữ cảnh và đối chiếu alert theo ngữ nghĩa, chọn **Google Gemini** hoặc **OpenAI** trong trang **Cài đặt chung** và nhập khóa của nhà cung cấp. Mặc định Gemini dùng `gemini-2.5-flash`, OpenAI dùng `gpt-4o-mini`. Sau khi lưu khóa, ứng dụng tải danh sách mô hình từ nhà cung cấp để lựa chọn. Nếu không tải được, có thể nhập tên mô hình thủ công. Danh sách không bảo đảm hạn mức hoặc quyền phân tích ảnh, hãy dùng nút kiểm tra kết nối. Khóa và mô hình được lưu trong phiên chạy.

Có thể cấu hình OpenAI bằng biến môi trường trước khi khởi động:

```bash
export OPENAI_API_KEY='<khóa của bạn>'
npm run dev
```

Khóa nhập trong giao diện chỉ lưu trong bộ nhớ của tiến trình và cần nhập lại khi khởi động lại. Không đưa khóa vào mã nguồn hoặc gửi khóa qua chat. Mặc định ứng dụng sử dụng `gpt-4o-mini`, có thể đổi bằng `OPENAI_MODEL`. `OPENAI_BASE_URL` mặc định là `https://api.openai.com/v1` và có thể thay cho một API tương thích Chat Completions. Với Gemini, có thể dùng `GEMINI_API_KEY` và tùy chọn `GEMINI_MODEL`. Môi trường cần cho phép kết nối HTTPS tới `generativelanguage.googleapis.com` cho Gemini hoặc `api.openai.com` cho OpenAI. Hạn mức và giá phụ thuộc vào nhà cung cấp và tài khoản.

Khi AI được bật, nội dung phiên, ảnh đính kèm và danh bạ liên hệ được gửi tới nhà cung cấp đã chọn để xử lý. Khi chưa có khóa hoặc kết nối AI lỗi, ứng dụng vẫn lưu phiên, tạo bản tin theo mẫu và tra alert bằng từ khóa. Chế độ này không đọc nội dung ảnh hoặc so khớp ngữ nghĩa. Kiểm tra lại nội dung trước khi gửi tới các kênh vận hành.

## Dữ liệu và sử dụng

- Lần chạy đầu tiên khởi tạo tên của 90 dịch vụ và 8 nhóm thị trường. Danh bạ có thể thêm, sửa, xóa. Thông tin liên hệ không được đưa vào repo công khai. Hãy xác nhận tính cập nhật của các liên hệ trước khi sử dụng.
- Để nhập danh bạ từ tài liệu gốc, khởi động ứng dụng một lần để tạo cơ sở dữ liệu, sau đó chạy `npm run import-contacts -- "/đường/dẫn/tới/tài-liệu.txt"`. Lệnh chỉ điền các trường liên hệ còn trống và giữ lại dữ liệu đã có. Tệp nguồn và cơ sở dữ liệu cần được lưu ở nơi phù hợp, không đưa lên repo công khai.
- Dùng **Dữ liệu liên hệ → Nhập Excel** để nhập tệp `Service_GSM_2026.xlsx` trực tiếp vào cơ sở dữ liệu trên máy đang chạy. Trường có dữ liệu trong tệp sẽ cập nhật liên hệ tương ứng, trường trống được giữ nguyên. Tệp và thông tin liên hệ không được đưa lên Git.
- Khi nhập hoặc dán sự cố đầu tiên, ứng dụng đề xuất dịch vụ, thị trường, mức độ và phạm vi. Có thể chỉnh thủ công, lựa chọn được lưu ngay trong phiên và các lần sửa khác với gợi ý sẽ được ghi nhớ theo thông tin sự cố khớp để dùng về sau. Cần kết nối AI để đọc hình ảnh và biên tập nội dung cập nhật thành đoạn ngắn.
- Trong **Cài đặt chung**, chỉnh ba việc tiếp theo và câu hỏi điều phối cho các sự cố mới.
- Kho alert ban đầu để trống. Thêm alert mẫu, thị trường, đầu mối và hướng xử lý trong **Quản lý alert**. Khi tra cứu, chọn thị trường để chỉ nhận quy tắc áp dụng cho thị trường đó hoặc cho tất cả thị trường.
- Một phiên chat tương ứng với một sự cố. Chọn **Sự cố mới** để bắt đầu phiên khác. Có thể dán hoặc tải tối đa 4 ảnh PNG, JPG, WEBP, GIF, mỗi ảnh tối đa 4 MB.
- Ứng dụng lưu dữ liệu và ảnh trong SQLite tại `data/noc.db`. Có thể chọn đường dẫn khác qua `NOC_DB_PATH`. Sao lưu cơ sở dữ liệu bằng cơ chế sao lưu SQLite khi cần giữ dữ liệu.
- Nhịp SLA trên giao diện tính từ thời điểm tạo bản tin trong ứng dụng, trước khi có solution. Xác nhận thời điểm thực tế đã gửi bản tin trên kênh vận hành.

Ứng dụng hiện dành cho môi trường tin cậy và chưa có đăng nhập, phân quyền hoặc mã hóa dữ liệu ở cấp ứng dụng. Cần bổ sung các khả năng này trước khi triển khai rộng cho nhiều người dùng.

## Cập nhật và chạy trên Windows không cần cài Node.js

Trong UCRT64 hoặc Git Bash, từ thư mục dự án chạy:

```bash
git pull --ff-only origin main && cmd.exe /c Chay-NOC.bat
```

Lần chạy đầu sẽ tải Node.js 24.22.1 portable từ nodejs.org và kiểm tra SHA-256. Mỗi lần chạy sẽ cài thư viện theo lockfile, build rồi khởi chạy tại `http://localhost:3001`. Cần có Git, PowerShell và kết nối tới nodejs.org cùng npm registry. Nếu lệnh pull gặp thay đổi cục bộ hoặc xung đột, hãy xử lý trước khi chạy lại. Nhấn Ctrl+C để dừng ứng dụng.

Cơ sở dữ liệu vẫn ở `data/noc.db` trong thư mục dự án. Nếu trước đây dùng gói ZIP NOC Hub, hãy sao chép tệp `app/data/noc.db` từ gói đó sang `data/noc.db` của dự án trước lần chạy đầu. Sao lưu dữ liệu hiện tại trước khi thay thế tệp đã tồn tại.
