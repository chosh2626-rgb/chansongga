# 🎵 찬송가 첫 소절 퀴즈

찬송가 첫 소절을 듣고 4지선다로 맞히는 실시간 퀴즈입니다. (띵커벨/카훗 방식)

- **진행 화면(메인 화면)**: `/host` — QR 코드, 문제, 가장 빠른 정답자, 순위 표시. 소리는 이 화면에서 납니다.
- **참가자 화면(휴대폰)**: `/` — QR로 접속 → 이름·연령대 입력 → 4개 보기 중 선택

## 내 컴퓨터에서 실행

```bash
npm install
npm start
```

진행 화면: http://localhost:3000/host

## Render 배포

1. 이 폴더를 GitHub 저장소에 올립니다.
2. Render → **New → Blueprint** → 저장소 선택 (`render.yaml` 이 자동 적용됩니다)
   - 또는 **New → Web Service**: Build `npm install`, Start `npm start`
3. 배포 후 `https://<앱이름>.onrender.com/host` 를 메인 화면에 띄웁니다.

환경변수(선택)

| 이름 | 설명 | 기본값 |
|---|---|---|
| `HOST_KEY` | 설정하면 `/host?key=값` 으로만 진행 화면 접속 가능 | 없음 |
| `TIME_LIMIT_SEC` | 문제당 제한 시간(초) | 20 |

> Render 무료 플랜은 15분간 접속이 없으면 잠들어, 첫 접속에 1분쯤 걸립니다. 행사 전에 미리 열어 두세요.

## 찬송가 추가·수정 (`hymns.js`)

```js
{ no: 305, title: '나 같은 죄인 살리신', audio: '/audio/305.mp3' }
```

- `audio`: `public/audio` 폴더의 첫 소절 mp3. 다른 음원으로 바꾸려면 같은 이름으로 파일만 교체하면 됩니다.
- `notes`: 음원이 없는 곡은 `음이름:박자` 멜로디를 브라우저가 직접 연주합니다.

### 음원 출처

`public/audio` 의 음원은 [Open Hymnal Project](http://openhymnal.org/)의 공개 저작물(public domain) 악보를
피아노 음색으로 변환해 첫 소절만 잘라낸 것입니다.

## 점수

한 문제 맞힐 때마다 10점. 점수가 같으면 정답을 더 빨리 누른 사람(걸린 시간 합이 짧은 사람)이 위 순위입니다. 문제마다 **가장 빨리 맞힌 사람**이 메인 화면에 크게 표시됩니다.
