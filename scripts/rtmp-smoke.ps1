param(
  [Parameter(Mandatory=$true)][string]$StreamKey,
  [int]$Seconds = 30
)
$ErrorActionPreference = 'Stop'
if ($StreamKey -notmatch '^room_\d+\?token=') { throw 'StreamKey 必须是主播中心显示的完整值：room_房间号?token=密钥' }
Write-Host "推送 ${Seconds} 秒测试画面到 rtmp://localhost/live"
docker run --rm --network host jrottenberg/ffmpeg:6.1-alpine `
  -re -f lavfi -i "testsrc2=size=1280x720:rate=30" `
  -f lavfi -i "sine=frequency=1000:sample_rate=44100" `
  -t $Seconds -c:v libx264 -preset veryfast -tune zerolatency -g 60 `
  -c:a aac -b:a 128k -f flv "rtmp://host.docker.internal/live/$StreamKey"
Write-Host '推流结束。检查直播间是否自动回到 OFFLINE，并确认直播记录。'
