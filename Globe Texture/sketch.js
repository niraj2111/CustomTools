let x = 0;
let y = 0;
let pg
let angle =0 ;
let totalFrames = 30
let img



// function preload() {
//   img = loadImage('/apv.png');

// }

function setup() {
  createCanvas(windowWidth, windowHeight,WEBGL);
  pg = createGraphics(200*2,2*100)
  // pg.rectMode(CENTER)
  // textureMode(IMAGE)
  // rectMode(CENTER)
  // background(173,174,182);
  background(255);
  // pg.pixelDensity(6)
  // img.resize(400,400)
  // image(img,0,0)

}

function draw() {
  // textFont(fontRegular);
  // ortho()
  // orbitControl();
  
  background(200);
  lightFalloff(1, 0.8, 0.8);
  // lightFalloff(0, 0, 0);
  lights()

  // pointLight(255, 255, 255, 0,0, 900);
  directionalLight(100,100,100,0.0,-0.0,-1)

  // ambientLight(255,255,255,240)
  

  pg.push()
  pg.background(26,152,240)
  pg.fill(255)
  // pg.rotate(PI)
  pg.textAlign(CENTER, CENTER)
  pg.textSize(30);
  pg.textLeading(30);
  // pg.rect(pg.width/4,pg.height/2,pg.width/4,pg.height/4)
  // pg.image(img,0,0)
  // pg.text("Amazon Prime",100,0,200,200)
  // pg.text("Amazon Prime",pg.width/2,pg.height/2,pg.width/1,pg.height)

// pg.pop()
// pg.push()
  // pg.fill(255,40)
  // pg.rect(pg.width/2,pg.height/2,pg.width/1,pg.height)
  // pg.stroke(0)

  // pg.ellipse(50,50,50)


  pg.pop()

  let t = (frameCount%120)/120;
  let eased = easeInOut(constrain(t,0,1)) -0.5
angle = eased * TWO_PI;
  // translate(width/2,height/2);

  push()
  // translate(-250,0,0)
  fill(0,0,255)
  noFill()
  // fill(0)
  ambientMaterial(26,152,240)

  texture(pg)
  noStroke()
  // rotateZ(-PI/6)
  // rotateY((frameCount/100))
  rotateY(angle)


  // sphere(300,24,16)
  sphere(200,30,30)

  pop()

// lightFalloff(1, 0, 0);
//  push();
//     translate(-25, 0, 0);
//     pointLight(250, 250, 250, 25, 0, 50);
//     noStroke()
//     sphere(20);
//     pop();
 
//     lightFalloff(0.97, 0.03, 0);
//     push();
//     noStroke()
//     translate(25, 0, 0);
//     pointLight(250, 250, 250, 25, 0, 50);
//     sphere(20);
//     pop();

  image(pg,250,0,pg.width,pg.height)






}
function easeInOut(t){
  return t<0.5 
  ? 4*t*t*t 
  : 1-pow(-2*t+2,3)/2;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}