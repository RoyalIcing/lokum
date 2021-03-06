const Hapi = require('hapi')
const Axios = require('axios')
const R = require('ramda')
const speakeasy = require('speakeasy')

const { routesForTrelloData, promiseEnhancedTrelloCards } = require('./trello')

function startServerForBoard(boardID, {
    seo = true,
    reloadSecret,
    host,
    port,
    addRoutes
} = {}) {
    const server = new Hapi.Server()
    server.connection({
        address: host,
        port
    })

    server.route({
        method: 'GET',
        path: '/-raw',
        handler(request, reply) {
            reply(JSON.stringify(boardJSON, null, 2))
        }
    })

    if (seo) {
        server.route({
            method: 'GET',
            path: '/robots.txt',
            handler(request, reply) {
                reply(
`User-agent: *
Disallow:
`

// Sitemap: https://burntcaramel.github.io/sitemap.xml
                ).type('text/plain')
            }
        })

        // TODO: sitemap
    }

    let reloadableServer
    let reloadableServerPromise

    function reloadFromTrello() {
        reloadableServerPromise = Axios.get(`https://trello.com/b/${ boardID }.json`)
        .then(({ data: boardJSON }) => {
            console.log('Loaded content from Trello', boardID)

            return promiseEnhancedTrelloCards(boardJSON.cards)
            .then((cards) => {
                console.log('Enhanced cards')

                const enhancedBoardJSON = R.merge(boardJSON, { cards })

                reloadableServer = new Hapi.Server()
                const reloadableConnection = reloadableServer.connection({ autoListen: false })
                reloadableServer.route(routesForTrelloData(enhancedBoardJSON))

                // Used for testing: boardJSON, enhancedBoardJSON
                return { boardJSON, enhancedBoardJSON, server: reloadableServer }
            })
        })

        return reloadableServerPromise
    }

    function forwardReplyToInternalServer(request, reply) {
        (reloadableServerPromise || reloadFromTrello())
        .then(({ server }) => (
            server.inject(request.url.href)
        ))
        .then((innerResponse) => {
            //console.log(innerResponse)
            const outerResponse = reply(innerResponse.rawPayload)
            outerResponse.code(innerResponse.statusCode)
            Object.keys(innerResponse.headers).map((key) => {
                outerResponse.header(key, innerResponse.headers[key])
            })
        })
    }

    if (reloadSecret) {
        server.route({
            method: 'GET',
            path: '/-reload/{token}',
            handler(request, reply) {
                const { token } = request.params
                const verified = speakeasy.totp.verify({
                    secret: reloadSecret,
                    encoding: 'base32',
                    token
                })

                if (verified) {
                    reloadFromTrello()
                    .then(() => reply({ success: true }))
                    .catch(reply)
                }
                else {
                    reply(new Error('Invalid token'))
                }
            }
        })
    }

    server.route({
        method: '*',
        path: '/{p*}',
        handler: forwardReplyToInternalServer
    })

    if (addRoutes) {
        addRoutes(server)
    }

    server.start()

    return reloadFromTrello()
    .then(({ boardJSON, enhancedBoardJSON }) => {
        console.log('Started server on port', server.info.port)
        return {
            // Used for testing
            internal: {
                boardJSON,
                enhancedBoardJSON,
                server,
                reloadableServer
            }
        }
    })
}

module.exports = startServerForBoard
