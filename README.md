# AI Studio TTS Batch — Extension Chrome

Tự động dán lần lượt từng đoạn (tách bằng dấu `---` trong file `.txt`) vào
**Google AI Studio → Generate Speech**, chờ tạo xong audio, tải về, rồi sang đoạn kế.

## 1. Cài đặt (chế độ Developer / unpacked)

1. Mở Chrome → vào `chrome://extensions`
2. Bật **Developer mode** (góc trên bên phải)
3. Bấm **Load unpacked** → chọn thư mục `aistudio-tts-extension` này
4. Xong. Extension chỉ chạy trên `https://aistudio.google.com/*`

> Edge cũng dùng được: `edge://extensions` → Load unpacked.

## 2. Cách dùng

1. Mở sẵn trang: `https://aistudio.google.com/generate-speech?model=gemini-3.1-flash-tts-preview`
   - Điền sẵn **Scene**, chọn **Speaker/giọng** như ý.
2. Một **panel đen** xuất hiện ở góc phải. Nếu không thấy → tải lại trang (F5).
3. Bấm **📄 Chọn file .txt** → chọn file kịch bản (vd `kich_ban_loi_binh_an.txt`).
   - Panel báo số đoạn đã tách.
4. Bấm **▶ Bắt đầu**. Extension chạy **tự động hết tất cả các đoạn**:
   - Mỗi đoạn: điền lời → **Run** → chờ audio xong → **tải về** → tự sang đoạn kế, tới hết.

File tải về đặt tên theo **số thứ tự tăng dần**: `1.wav`, `2.wav`, `3.wav`, … trong
thư mục **Tải xuống** (Downloads). (Đuôi file `.wav`/`.mp3` tùy định dạng AI Studio trả về.)

> Lần đầu Chrome có thể hỏi *"site muốn tự tải nhiều file"* → bấm **Allow** để chạy mượt.

> Muốn chạy có dừng/xác nhận giữa các đoạn: **tích** ô "Dừng chờ xác nhận giữa các đoạn".

## 3. Nếu nó "không tìm thấy" ô lời / nút Run / Download

DOM của AI Studio hay đổi. Mở mục **⚙ Nâng cao** trong panel:

- Bấm **Test ô lời / Test nút Run / Test Download** → phần tử đúng sẽ nháy viền hồng.
- Nếu nháy sai phần tử (hoặc báo không thấy):
  1. Mở DevTools (F12) → công cụ chọn phần tử (mũi tên) → click vào ô/nút đúng.
  2. Chuột phải node trong tab Elements → **Copy → Copy selector**.
  3. Dán vào ô selector tương ứng trong panel. Test lại cho tới khi đúng.

### Tải audio: 2 cách
- **Tải bằng nút Download của AI Studio** (mặc định bật): bấm đúng nút download của trang.
- Bỏ chọn → extension tự lấy blob từ thẻ `<audio>` và tải (đặt tên theo số thứ tự).
  Dùng cách này nếu cách trên không bắt được nút.

## 4. Các nút phụ
- **Chỉ điền / Run / Tải audio**: thao tác thủ công từng bước (debug).
- **◀ Lùi / ⏭ Tiếp**: di chuyển giữa các đoạn.
- **⏹ Dừng**: ngừng vòng lặp.
- Kéo thanh tiêu đề để di chuyển panel; nút **▁** để thu gọn.

## 5. Giới hạn cần biết
- Đây là tự động hóa giao diện, **phụ thuộc DOM AI Studio** — Google đổi layout thì cần chỉnh selector.
- Tôn trọng giới hạn (rate limit/quota) của AI Studio; chạy quá nhanh có thể bị chặn.
- Thời gian chờ tối đa mỗi đoạn chỉnh ở **Nâng cao** (mặc định 240s).
