/* ==================== 照片库（AI 发图的素材） ==================== */
/* 用户添加的照片存 localStorage（phone_album，压缩 dataURL），他用这些照片发私聊/朋友圈 */

function getAlbumPhotos() {
  return lsGet('album', []);
}

/* canvas 压缩图片 → dataURL（最长边 maxSize，JPEG 0.7） */
function compressImageFile(file, maxSize) {
  return new Promise(function(resolve, reject) {
    if (!file || !file.type || file.type.indexOf('image/') !== 0) { reject(new Error('请选择图片文件')); return; }
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function() {
      try {
        var scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      } catch(e) { URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
    img.src = url;
  });
}

/* 上传照片到相册（压缩后存 dataURL） */
function addAlbumPhoto(file) {
  return compressImageFile(file, 900).then(function(dataUrl) {
    var album = getAlbumPhotos();
    album.unshift({ id: Date.now() + '_' + Math.random().toString(36).slice(2,6), src: dataUrl, time: Date.now() });
    lsSet('album', album);
    return album[0];
  });
}

function deleteAlbumPhoto(id) {
  var album = getAlbumPhotos().filter(function(p) { return p.id !== id; });
  lsSet('album', album);
  return album;
}
