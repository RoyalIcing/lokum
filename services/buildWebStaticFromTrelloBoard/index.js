const Axios = require('axios')
const Path = require('path')
const FS = require('fs')
const { promiseEnhancedTrelloCards, routesForTrelloData } = require('../../src/trello')
const conformPath = require('../../src/conformPath')
const static = require('../../src/static')

exports.buildWebStaticFromTrelloBoard = function buildWebStaticFromTrelloBoard() {
  const boardID = process.env.BOARD_ID
  const pathComponents = (process.env.PATH || '/').split('/')

  if (!boardID || boardID.length === 0) {
    console.error('Pass a Trello board ID to environment variable BOARD_ID')
    return
  }

  const buildDir = Path.join(process.cwd(), 'build')

  Axios.get(`https://trello.com/b/${ boardID }.json`)
  .then(({ data: boardJSON }) => {
    console.log('Loaded content from Trello', boardID)

    return promiseEnhancedTrelloCards(boardJSON.cards)
    .then((cards) => {
      console.log('Enhanced cards')

      const enhancedBoardJSON = Object.assign({}, boardJSON, { cards })

      const routes = routesForTrelloData(enhancedBoardJSON)
      const pathToFind = conformPath('/' + pathComponents.join('/'))

      const fileContentsPromise = static.promiseFileContentsForRoutes(routes)
      if (fileContentsPromise) {
        return fileContentsPromise
      }
      else {
        console.error('Error building static site')
      }
    })
  })
  .then(fileContents => Promise.all(
    [
      new Promise((resolve, reject) => {
        FS.mkdir(
          Path.join(process.cwd(), 'build'),
          (error) => {
            if (error) {
              reject(error)
            }
            else {
              resolve(true)
            }
          }
        )
      })
    ].concat(
      Object.keys(fileContents).map(filePath => {
        const dirPaths = []
        let currentDir = filePath
        do {
          currentDir = Path.dirname(currentDir)
          if (currentDir === '.') {
            break;
          }
          dirPaths.push(currentDir)
        } while (currentDir !== '.');

        return Promise.all(dirPaths.reverse().map(dirPath => {
          new Promise((resolve, reject) => {
              FS.mkdir(Path.join(buildDir, dirPath), (error) => {
                if (error && error.code !== 'EEXIST') {
                  console.error(error)
                  reject(error)
                }
                else {
                  resolve()
                }
              })
            })
        }))
          .then(() => {
            new Promise((resolve, reject) => {
              FS.writeFile(
                Path.join(buildDir, filePath),
                fileContents[filePath],
                (error) => {
                  if (error) {
                    reject(error)
                  }
                  else {
                    resolve(true)
                  }
                }
              )
            })
          })
        }
      )
    ))
  )
  .catch(error => {
    console.error(error)
  })
};

