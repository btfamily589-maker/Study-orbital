/* 프사 압축. 예전 Replit 앱(ITERATERS)의 compressProfileImage를 옮겨온 것 —
 * 가운데를 정사각으로 잘라 160px로 줄이고 JPEG로 굽는다. 그 결과 data URL은
 * 몇 KB 수준이라 Firestore 문서에 그대로 넣어도 된다. */
export function compressProfilePhoto(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('이미지 파일이 아닙니다.'))
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          const size = 160
          canvas.width = size
          canvas.height = size
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            resolve(event.target?.result)
            return
          }
          const minSide = Math.min(img.width, img.height)
          const sx = (img.width - minSide) / 2
          const sy = (img.height - minSide) / 2
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size)
          resolve(canvas.toDataURL('image/jpeg', 0.7))
        } catch {
          resolve(event.target?.result)
        }
      }
      img.onerror = () => reject(new Error('사진을 읽지 못했습니다.'))
      img.src = event.target?.result
    }
    reader.onerror = () => reject(new Error('사진을 읽지 못했습니다.'))
    reader.readAsDataURL(file)
  })
}
