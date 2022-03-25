function genTitle(){

var newDiv = document.createElement('div');
    newDiv.innerHTML = '<h1 contenteditable="tru" class="text-center">Hello world!!!</h1>';
    var script = document.getElementsByClassName("test")[0];
    var parent = script.parentNode;
    parent.insertBefore(newDiv, script);
    document.getElementById("collapsed").hidden = true;
}

function genCover() {

    var newDiv = document.createElement('div');
    newDiv.innerHTML = '<article class="cover"><h4 class="cover__uptitle">your company</h4><h1 class="cover__title">Title/TagLine</h1><p class="cover__description">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Maecenas lobortis odio vel varius sollicitudin.</p></article>';
    var script = document.getElementsByClassName("test")[0];
    var parent = script.parentNode;
    parent.insertBefore(newDiv, script);
    document.getElementById("collapsed").hidden = true;
}