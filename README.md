# BuddyPet

VS Code 사이드바에서 작은 캐릭터를 키울 수 있는 개인용 펫 익스텐션입니다.

파일을 저장하면 경험치가 오르고, 배고픔과 에너지, 행복도를 관리하면서 캐릭터를 돌볼 수 있습니다.  
상태별 이미지는 직접 만든 캐릭터 이미지로 자유롭게 교체할 수 있습니다.

## 기능

- VS Code 왼쪽 Activity Bar에 펫 전용 뷰 추가
- 배고픔, 에너지, 행복도, 경험치, 레벨 관리
- 파일 저장 시 경험치 증가
- `Pet`, `Feed`, `Play`, `Nap` 상호작용 제공
- 상태를 VS Code `globalState`에 저장
- `media/states/` 폴더의 사용자 이미지를 자동으로 불러옴

## 프로젝트 구조

```text
buddypet/
├─ media/
│  ├─ icon.svg
│  └─ states/
├─ src/
├─ package.json
└─ README.md
```

## 상태별 이미지 규칙

직접 만든 캐릭터 이미지는 아래 경로에 넣으면 됩니다.

`media/states/`

사용하는 기본 파일명은 아래와 같습니다.

- `idle`
- `happy`
- `sleepy`
- `hungry`
- `excited`

지원 확장자는 아래와 같습니다.

- `.png`
- `.jpg`
- `.jpeg`
- `.webp`
- `.gif`
- `.svg`

예를 들면 이런 식으로 넣으면 됩니다.

- `media/states/idle.png`
- `media/states/happy.gif`
- `media/states/sleepy.webp`
- `media/states/hungry.png`
- `media/states/excited.gif`

특정 상태 이미지가 없으면 아래 순서로 대체됩니다.

1. 같은 상태 이름 파일 탐색
2. `idle` 이미지 사용
3. 기본 포함된 플레이스홀더 SVG 사용

배경이 투명한 캐릭터를 쓰고 싶다면 `png` 또는 투명 `webp`를 추천합니다.  
움직이는 캐릭터를 쓰고 싶다면 `gif`도 사용할 수 있습니다.

## 설치 방법

이 프로젝트를 사용하는 방법은 크게 2가지입니다.

1. `.vsix`로 설치해서 평소 VS Code에서 사용하기
2. 개발 모드로 실행해서 직접 수정하며 테스트하기

개인적으로 사용할 목적이라면 보통 `.vsix` 설치 방식이 가장 편합니다.

## 방법 1. `.vsix`로 설치하기

### 1) 저장소 준비

먼저 저장소를 클론하거나 압축을 받아서 프로젝트를 준비합니다.

```bash
git clone https://github.com/ahnselim/buddypet.git
cd buddypet
```

`<your-name>` 부분은 실제 GitHub 사용자명 또는 조직명으로 바꿔야 합니다.

### 2) 패키지 설치

```bash
npm install
```

### 3) VSIX 파일 생성

```bash
npm run compile
npm run package
```

완료되면 프로젝트 루트에 아래와 비슷한 파일이 생성됩니다.

```text
code-buddy-pet-0.0.1.vsix
```

### 4) VS Code에 설치

1. VS Code를 엽니다.
2. 왼쪽 Extensions 탭을 엽니다.
3. Extensions 화면 오른쪽 위의 `...` 메뉴를 누릅니다.
4. `Install from VSIX...` 를 선택합니다.
5. 방금 생성한 `.vsix` 파일을 선택합니다.
6. 설치가 끝나면 VS Code를 다시 로드합니다.

설치가 끝나면 왼쪽 Activity Bar에 펫 아이콘이 생기고, 그 안에서 캐릭터를 볼 수 있습니다.

## 방법 2. 개발 모드로 실행하기

확장을 수정하면서 바로 테스트하고 싶다면 이 방법을 사용하면 됩니다.

### 준비물

- Node.js
- npm
- VS Code

### 1) 저장소 클론

```bash
git clone https://github.com/ahnselim/buddypet.git
cd buddypet
```

### 2) 의존성 설치 및 빌드

```bash
npm install
npm run compile
```

### 3) VS Code에서 실행

1. `buddypet` 폴더를 VS Code로 엽니다.
2. `F5` 키를 누릅니다.
3. 새 창인 `Extension Development Host`가 열립니다.
4. 새 창의 왼쪽 Activity Bar에서 펫 아이콘을 누릅니다.
5. 펫 뷰가 열리면 정상 실행입니다.

코드를 수정한 뒤 다시 반영하려면 아래 명령을 실행한 뒤 개발 호스트 창을 다시 로드하면 됩니다.

```bash
npm run compile
```

## 펫 이미지 교체 방법

직접 만든 캐릭터 이미지를 넣는 기본 흐름은 아래와 같습니다.

1. `media/states/` 폴더를 엽니다.
2. 기존 예시 SVG를 유지하거나 원하는 이미지로 교체합니다.
3. 파일명을 상태 이름에 맞게 저장합니다.
4. VS Code를 다시 로드하거나 개발 호스트를 재시작합니다.

예시:

```text
media/states/idle.gif
media/states/happy.gif
media/states/sleepy.png
media/states/hungry.png
media/states/excited.webp
```

이미지 크기는 자유지만, 너무 큰 파일보다는 적당한 크기의 정사각형 이미지가 보기 좋습니다.  
보통 `512x512` 또는 `1024x1024` 정도면 충분합니다.

## 사용 가능한 명령어

Command Palette에서 아래 명령을 사용할 수 있습니다.

- `Code Buddy Pet: Focus Pet View`
- `Code Buddy Pet: Feed Pet`
- `Code Buddy Pet: Play With Pet`
- `Code Buddy Pet: Let Pet Nap`
- `Code Buddy Pet: Pet Pet`
- `Code Buddy Pet: Reset Pet`
- `Code Buddy Pet: Open Asset Folder`

## 동작 방식

- 파일을 저장하면 경험치가 조금 올라갑니다.
- 시간이 지나면 배고픔이 증가하고 에너지와 행복도가 조금씩 감소합니다.
- 상태에 따라 `happy`, `sleepy`, `hungry`, `excited`, `idle` 이미지 중 하나가 자동으로 표시됩니다.
- 진행 상태는 VS Code 내부 저장소에 보관되므로 다시 열어도 이어집니다.

## 직접 패키징하기

직접 `.vsix` 파일을 다시 만들고 싶다면 아래 명령을 실행하면 됩니다.

```bash
npm run compile
npm run package
```

완료되면 프로젝트 루트에 `.vsix` 파일이 생성됩니다.

## GitHub 배포용으로 추가하면 좋은 것

아직 없어도 동작에는 문제 없지만, 공개 저장소로 정리할 때는 아래 파일들을 추가하면 좋습니다.

- `LICENSE`
- 저장소 주소가 들어간 `repository` 필드
- 사용 예시 스크린샷
- 확장 아이콘 또는 배너 이미지

## 문제 해결

### 펫 아이콘이 안 보일 때

- 확장이 정상 설치되었는지 확인합니다.
- VS Code에서 `Developer: Reload Window`를 실행합니다.
- 개발 모드라면 `F5`로 열린 `Extension Development Host` 창에서 확인합니다.

### 이미지가 바뀌지 않을 때

- 파일명이 상태 이름과 정확히 일치하는지 확인합니다.
- 확장자가 지원 형식인지 확인합니다.
- VS Code 창을 다시 로드합니다.

### 캐릭터가 네모 배경으로 보일 때

- `jpg`는 배경 투명이 되지 않습니다.
- 투명 배경이 필요하면 `png` 또는 `webp`를 사용하는 것이 좋습니다.
