import { CommandParser } from './CommandParser.js'
import { fitAspectRatio } from '../core/utils.js'
import { WIDTH, HEIGHT } from '../core/constants.js'
import { Group } from './Group.js'

export const api = {}

export class GraphicEntityModule {
  constructor (assets) {
    this.entities = new Map()
    this.frames = []
    this.loadingAssets = 0

    this.extrapolationMap = {}

    this.globalData = {
      coeff: 1,
      mustResetTree: true,
      mustResort: true,
      maskUpdates: {},
      updatedBuffers: [],
      players: [],
      instanceCount: 0,
      atLeastOnePixel: function (width) {
        if (width > 0 && width < this.toPixel) {
          return this.toPixel
        }
        return width
      }
    }

    api.entities = this.entities
  }

  static get name () {
    return 'entitymodule'
  }

  handleFrameData (frameInfo, frameData) {
    const number = frameInfo.number
    for (const line of frameData) {
      if (line) {
        const command = CommandParser.parse(line, this.globalData, frameInfo)
        const loadPromise = command.apply(this.entities, number)
        if (loadPromise) {
          this.loadingAssets++
          loadPromise.then(() => {
            this.loadingAssets--
          })
        }
      }
    }
    this.extrapolate(number)

    const parsedFrame = {...frameInfo}

    parsedFrame.previous = this.frames[this.frames.length - 1] || parsedFrame
    if (parsedFrame !== parsedFrame.previous) {
      parsedFrame.previous.next = parsedFrame
    }

    this.frames.push(parsedFrame)

    return parsedFrame
  }

  lastElementOf (arr) {
    return arr[arr.length - 1]
  }

  extrapolate (frameNumber) {
    this
      .entities.forEach(entity => {
        // Create empty substate array if none
        if (!entity.states[frameNumber]) {
          entity.states[frameNumber] = []
        }
        // Copy default state if extrapolation just started
        if (!this.extrapolationMap[entity.id]) {
          this.extrapolationMap[entity.id] = { ...entity.defaultState }
        }

        const currentState = this.extrapolationMap[entity.id]
        const subStates = entity.states[frameNumber]

        // Sort on t to begin extrapolation
        subStates.sort((a, b) => a.t - b.t)

        for (const state of subStates) {
          // Extrapolate through existing substates, updating the extrapolationMap in the process (currentState)
          Object.assign(currentState, state)
          Object.assign(state, currentState)
        }

        if (!subStates.length || this.lastElementOf(subStates).t !== 1) {
          // Create a subState at t=1
          subStates.push({ ...currentState, t: 1 })
        }
      })
  }

  reinitScene (container, canvasData) {
    this.globalData.toPixel = (WIDTH / canvasData.width) * canvasData.oversampling
    this.globalData.mustResetTree = true
    api.container = this.container = container
    this.entities.forEach((e) => {
      e.init()
    })
  }

  sortChildren (container) {
    container.children.sort((a, b) => {
      if (a.zIndex === b.zIndex) {
        return a.id - b.id
      } else {
        return a.zIndex - b.zIndex
      }
    })
  }

  stillLoading () {
    return this.loadingAssets > 0
  }

  updateScene (previousData, currentData, progress) {
    if (this.stillLoading()) {
      return
    }

    this.entities.forEach(e => e.render(progress, currentData, this.globalData))

    // Flags are set by Entity when a zIndex changes, or a group has different children
    if (this.globalData.mustResetTree) {
      this.reconstructTree()
      this.globalData.mustResetTree = false
      this.globalData.mustResort = true
    }
    if (this.globalData.mustResort) {
      this.resortTree()
      this.globalData.mustResort = false
    }
    for (let entityId in this.globalData.maskUpdates) {
      const entity = this.entities.get(+entityId)
      const maskId = this.globalData.maskUpdates[entityId]
      if (maskId === -1) {
        entity.container.mask = null
      } else {
        entity.container.mask = this.entities.get(maskId).graphics
      }
    }
    for (let entity of this.globalData.updatedBuffers) {
      entity.postUpdate()
    }
    this.globalData.maskUpdates = {}
  }

  resortTree () {
    // Groups
    this.entities.forEach(e => {
      if (e instanceof Group) {
        this.sortChildren(e.childrenContainer)
      }
    })
    // Parent
    this.sortChildren(this.container)
  }

  reconstructTree () {
    this.container.removeChildren()

    // Groups
    this.entities.forEach(e => {
      if (e instanceof Group) {
        e.childrenContainer.removeChildren()
        e.currentState.children.forEach(id => {
          e.childrenContainer.addChild(this.entities.get(id).container)
        })
      }
    })

    // Parent
    this.entities.forEach(e => {
      if (!e.container.parent) {
        this.container.addChild(e.container)
      }
    })
  }

  handleGlobalData (players, globalData) {
    this.globalData.players = players
    const width = globalData.width
    const height = globalData.height
    this.globalData.coeff = fitAspectRatio(width, height, WIDTH, HEIGHT)
    api.coeff = this.globalData.coeff
  }
}
