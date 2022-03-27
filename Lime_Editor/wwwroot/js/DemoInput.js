var file = document.getElementById("file-chooser").files[0];
var fReader = new FileReader();
fReader.onload = (function (aFile) {
    return function (e) {
        var span = document.createElement('span');
        span.innerHTML = ['<img class="images" src="', e.target.result, '" title="', aFile.name, '"/>'].join('');
        document.getElementById('thumbs').insertBefore(span, null);
    };
})(f);
fReader.readAsDataURL(file);