function helloWorld(name = "world") {
  return `Hello, ${name}!`;
}

if (require.main === module) {
  console.log(helloWorld());
}

module.exports = {
  helloWorld
};
