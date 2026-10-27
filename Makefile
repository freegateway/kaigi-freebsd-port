PORTNAME=	kaigi
DISTVERSION=	0.1.0
PORTREVISION=	5
CATEGORIES=	www
DIST_SUBDIR=	${PORTNAME}
EXTRACT_ONLY=	${DISTNAME}${EXTRACT_SUFX}

MAINTAINER=	brad@freegateway.org
COMMENT=	Privacy-hardened self-hosted video conferencing
WWW=		https://github.com/freegateway/kaigi

LICENSE=	AGPLv3
LICENSE_FILE=	${WRKSRC}/LICENSE

RUN_DEPENDS=	mediasoup>=3.32.0:www/mediasoup \
		node24>=0:www/node24

USES=		python:env shebangfix
USE_GITHUB=	yes
GH_ACCOUNT=	freegateway
GH_TAGNAME=	fe86820e0b4017260727a826e8f6d1dcf7caebc9

ETCDIR=		${PREFIX}/etc/kaigi
WWWDIR=		${PREFIX}/www/kaigi

NO_ARCH=	yes
NO_BUILD=	yes
SUB_FILES=	kaigi kaigi.newsyslog.conf pkg-message
SUB_LIST=	KAIGI_SOURCE_URL=${_KAIGI_SOURCE_URL}

_KAIGI_APP_TEMPLATES=		kaigi.8 kaigi.conf.5 kaigi-ldap.conf.5 \
				kaigi.conf.sample kaigi-ldap.conf.sample
_CORRESPONDING_SOURCE_DIR=	${WRKDIR}/corresponding-source
_CORRESPONDING_USR_DIR=		${_CORRESPONDING_SOURCE_DIR}/usr
_CORRESPONDING_USR_PORTS_DIR=	${_CORRESPONDING_USR_DIR}/ports
_CORRESPONDING_SOURCE_FILE=	/tmp/${PKGNAME}-source.tar.xz
_KAIGI_SOURCE_URL=		https://dev.freegateway.org/freebsd/corresponding_source/kaigi/${PKGNAME}-source.tar.xz
_NPM_DISTDIR=			${DISTDIR}/${DIST_SUBDIR}

.include <bsd.port.options.mk>
.include "npm-deps.mk"

post-extract:
.for module filename in ${_NPM_MODULES}
	${MKDIR} ${WRKSRC}/${module}
	${TAR} -xzf ${_NPM_DISTDIR}/${filename} \
		-C ${WRKSRC}/${module} --strip-components 1 \
		--no-same-owner --no-same-permissions
.endfor

corresponding-source: checksum
	${RM} -r ${_CORRESPONDING_SOURCE_DIR}
	${MKDIR} ${_CORRESPONDING_USR_PORTS_DIR}/distfiles/kaigi \
		${_CORRESPONDING_USR_PORTS_DIR}/www/kaigi
	${CP} ${.CURDIR}/Makefile ${.CURDIR}/npm-deps.mk \
		${.CURDIR}/distinfo ${.CURDIR}/pkg-descr \
		${_CORRESPONDING_USR_PORTS_DIR}/www/kaigi/
	${CP} -R ${FILESDIR} ${_CORRESPONDING_USR_PORTS_DIR}/www/kaigi/files
	@for filePath in ${DISTFILES:C/:.*//}; do \
		${CP} ${_NPM_DISTDIR}/$${filePath} \
			${_CORRESPONDING_USR_PORTS_DIR}/distfiles/kaigi/ || exit 1; \
	done
	${RM} -f ${_CORRESPONDING_SOURCE_FILE}
	${TAR} -C ${_CORRESPONDING_SOURCE_DIR} -cJf \
		${_CORRESPONDING_SOURCE_FILE} usr
	@${ECHO_MSG} "Created ${_CORRESPONDING_SOURCE_FILE}"

# These templates belong to the pinned application source. Keep the installed
# names and substitutions identical to the former port-local copies.
post-patch:
.for template in ${_KAIGI_APP_TEMPLATES}
	${SED} -e 's|%%PREFIX%%|${PREFIX}|g' \
		-e 's|%%WWWDIR%%|${WWWDIR}|g' \
		-e 's|%%DOCSDIR%%|${DOCSDIR}|g' \
		${WRKSRC}/packaging/freebsd/${template}.in > ${WRKDIR}/${template}
.endfor

do-install:
	${MKDIR} ${STAGEDIR}${WWWDIR}
	(cd ${WRKSRC} && ${COPYTREE_SHARE} \
		"app public node_modules package.json package-lock.json LICENSE" \
		${STAGEDIR}${WWWDIR})
	${LN} -s ${LOCALBASE}/lib/node_modules/mediasoup \
		${STAGEDIR}${WWWDIR}/node_modules/mediasoup
	${MKDIR} ${STAGEDIR}${PREFIX}/etc/rc.d
	${INSTALL_SCRIPT} ${WRKDIR}/kaigi \
		${STAGEDIR}${PREFIX}/etc/rc.d/kaigi
	${MKDIR} ${STAGEDIR}${ETCDIR}/site-assets ${STAGEDIR}${ETCDIR}/ldap
	${INSTALL_DATA} ${WRKDIR}/kaigi.conf.sample \
		${STAGEDIR}${ETCDIR}/kaigi.conf.sample
	${INSTALL_DATA} ${WRKDIR}/kaigi-ldap.conf.sample \
		${STAGEDIR}${ETCDIR}/ldap/ldap.conf.sample
.for sample in site-translations.json meeting-properties.json
	${INSTALL_DATA} ${WRKSRC}/packaging/freebsd/${sample}.sample \
		${STAGEDIR}${ETCDIR}/${sample}.sample
.endfor
.for sample in site.css privacy-private.html privacy-public.html
	${INSTALL_DATA} ${WRKSRC}/packaging/freebsd/${sample}.sample \
		${STAGEDIR}${ETCDIR}/site-assets/${sample}.sample
.endfor
	${INSTALL_DATA} -m 0600 ${WRKSRC}/packaging/freebsd/users.sample \
		${STAGEDIR}${ETCDIR}/users.sample
	${INSTALL_DATA} ${WRKSRC}/packaging/freebsd/group-meetings.json.sample \
		${STAGEDIR}${ETCDIR}/ldap/group-meetings.json.sample
	${LN} -s ../../../etc/kaigi/site-assets \
		${STAGEDIR}${WWWDIR}/public/site-assets
	${MKDIR} ${STAGEDIR}${PREFIX}/share/man/man8 \
		${STAGEDIR}${PREFIX}/share/man/man5
	${INSTALL_MAN} ${WRKDIR}/kaigi.8 \
		${STAGEDIR}${PREFIX}/share/man/man8/kaigi.8
	${INSTALL_MAN} ${WRKDIR}/kaigi.conf.5 \
		${STAGEDIR}${PREFIX}/share/man/man5/kaigi.conf.5
	${INSTALL_MAN} ${WRKDIR}/kaigi-ldap.conf.5 \
		${STAGEDIR}${PREFIX}/share/man/man5/kaigi-ldap.conf.5
	${MKDIR} ${STAGEDIR}${DOCSDIR}
.for doc in README.md HARDENING.md
	${INSTALL_DATA} ${WRKSRC}/${doc} ${STAGEDIR}${DOCSDIR}/${doc}
.endfor
.for doc in BASELINE.md UPSTREAM.md vendor-files.json
	${INSTALL_DATA} ${WRKSRC}/docs/${doc} ${STAGEDIR}${DOCSDIR}/${doc}
.endfor
	${MKDIR} ${STAGEDIR}${EXAMPLESDIR}/fail2ban
	${INSTALL_DATA} ${WRKSRC}/packaging/freebsd/fail2ban/kaigi.conf \
		${STAGEDIR}${EXAMPLESDIR}/fail2ban/kaigi.conf
	${MKDIR} ${STAGEDIR}${PREFIX}/etc/newsyslog.conf.d
	${INSTALL_DATA} ${WRKDIR}/kaigi.newsyslog.conf \
		${STAGEDIR}${PREFIX}/etc/newsyslog.conf.d/kaigi.conf

post-install:
	@${FIND} ${STAGEDIR}${WWWDIR} \( -type f -o -type l \) | \
		${SORT} | ${SED} -e 's,^${STAGEDIR}${PREFIX}/,,' > ${TMPPLIST}
	@${SED} -e 's|%%DOCSDIR%%|${DOCSDIR:S,^${PREFIX}/,,}|g' \
		-e 's|%%EXAMPLESDIR%%|${EXAMPLESDIR:S,^${PREFIX}/,,}|g' \
		${FILESDIR}/plist-extra >> ${TMPPLIST}

.include <bsd.port.mk>
