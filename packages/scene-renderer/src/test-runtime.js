;(function () {
  let canvas
  let ctx
  let spec
  let opts

  window.SceneRuntime = {
    async init(nextSpec, nextOpts) {
      spec = nextSpec
      opts = nextOpts
      canvas = document.getElementById("scene")
      if (!canvas) {
        canvas = document.createElement("canvas")
        canvas.id = "scene"
        document.body.appendChild(canvas)
      }
      canvas.width = opts.width
      canvas.height = opts.height
      canvas.style.width = `${opts.width}px`
      canvas.style.height = `${opts.height}px`
      ctx = canvas.getContext("2d")
      this.renderFrame(0)
    },
    renderFrame(frame) {
      if (!ctx || !canvas || !spec || !opts) throw new Error("SceneRuntime not initialized")
      ctx.fillStyle = spec.background || "#0a0a0c"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      const t = frame / opts.fps
      const x = Math.round((canvas.width - 80) * ((Math.sin(t * Math.PI * 2) + 1) / 2))
      const y = Math.round(canvas.height * 0.45)
      ctx.fillStyle = "#ff3366"
      ctx.fillRect(x, y, 80, 80)
      ctx.fillStyle = "#ffffff"
      ctx.font = "24px sans-serif"
      ctx.fillText(`frame ${frame}`, 16, 36)
    },
    durationInFrames() {
      if (!spec || !opts) return 0
      return Math.ceil(spec.durationSeconds * opts.fps)
    },
    start() {},
    stop() {},
  }
})()
